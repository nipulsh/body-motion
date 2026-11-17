import { beforeEach, describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../config';
import { measureDeadliftForm } from '../exercise/deadliftForm';
import { hinge } from '../test/deadliftHinge';
import {
  assessNeutralSpineProfile,
  NeutralSpineCalibrator,
  resetNeutralSpineProfile,
  setNeutralSpineProfile,
  type NeutralSpineObservation,
  type NeutralSpineProfile,
} from './NeutralSpineCalibrator';
import { OneEuroFilter } from './PostureTemporalTracker';
import { classifyPosture, type RoundingLatch } from './PostureClassifier';
import { initialDeadliftPhaseState, stepDeadliftPhase } from './deadliftPhase';

const OPEN: RoundingLatch = { thoracic: false, lumbar: false };

function baseline(over: Partial<NeutralSpineProfile> = {}): NeutralSpineProfile {
  return {
    version: 1,
    capturedAt: 1_000,
    thoracicSagitta: 0,
    lumbarSagitta: 0,
    trunkLeanDeg: 5,
    hipAngleDeg: 165,
    hipShoulderScale: 0.4,
    sampleCount: 8,
    ...over,
  };
}

function observation(over: Partial<NeutralSpineObservation> = {}): NeutralSpineObservation {
  return {
    thoracicSagitta: 0.01,
    lumbarSagitta: 0.01,
    thoracicConfidence: 0.9,
    lumbarConfidence: 0.9,
    trunkLeanDeg: 4,
    hipAngleDeg: 160,
    hipShoulderScale: 0.4,
    upright: true,
    sideOn: true,
    ...over,
  };
}

describe('spine contour regions', () => {
  it('reads a flat outline as an even offset, and an S-curve as opposite regions', () => {
    const flat = measureDeadliftForm(hinge())!;
    expect(Math.abs(flat.thoracic.sagitta!)).toBeLessThan(0.05);
    expect(Math.abs(flat.lumbar.sagitta!)).toBeLessThan(0.05);
    const curve = measureDeadliftForm(hinge({ sCurvePx: 14 }))!;
    expect(curve.thoracic.sagitta!).toBeGreaterThan(curve.lumbar.sagitta!);
    expect(Math.abs(curve.backBendDeg!)).toBeLessThan(20);
  });

  it('drops the outline when the mask is empty', () => {
    const pose = hinge();
    pose.silhouette = { ...pose.silhouette!, data: new Uint8Array(pose.silhouette!.data.length) };
    const frame = measureDeadliftForm(pose)!;
    expect(frame.backCheck).toBe('outline_unavailable');
    expect(frame.view.landmarksVisible).toBe(true);
    expect(frame.thoracic.sagitta).toBeNull();
    expect(frame.lumbar.sagitta).toBeNull();
    expect(frame.trunkInclinationDeg).toBeGreaterThan(40);
  });
});

describe('One Euro filter', () => {
  const config = VISION_CONFIG.deadliftForm.oneEuro;

  it('follows a held step within half a second, and a spike starts back down on the next frame', () => {
    const spike = new OneEuroFilter(config);
    let t = 0;
    for (let i = 0; i < 6; i += 1) {
      spike.filter(0, t);
      t += 66;
    }
    const jumped = spike.filter(1, t);
    t += 66;
    expect(spike.filter(0, t)).toBeLessThan(jumped);

    const step = new OneEuroFilter(config);
    t = 0;
    step.filter(0, t);
    let value = 0;
    for (t = 66; t <= 500; t += 66) value = step.filter(1, t);
    expect(value).toBeGreaterThan(0.6);
  });
});

describe('neutral spine calibration', () => {
  beforeEach(() => {
    resetNeutralSpineProfile();
  });

  it('waits for several frames, then keeps that baseline', () => {
    const calibrator = new NeutralSpineCalibrator({
      minFrames: 3,
      minDurationMs: 100,
      maxAgeMs: 1_000,
      maxTrunkLeanDeg: 12,
      minContourConfidence: 0.5,
    });
    expect(calibrator.observe(observation(), 0)).toBeNull();
    expect(calibrator.observe(observation(), 40)).toBeNull();
    const locked = calibrator.observe(observation({ thoracicSagitta: 0.03 }), 140);
    expect(locked?.sampleCount).toBe(3);
    expect(locked?.thoracicSagitta).toBeCloseTo(0.01);
    expect(calibrator.observe(observation({ thoracicSagitta: 0.9 }), 300)?.thoracicSagitta).toBeCloseTo(0.01);
  });

  it('ignores a single frame, a stale profile, and a profile that is not a baseline', () => {
    const now = 10_000;
    expect(assessNeutralSpineProfile(null, now, 1_000).status).toBe('missing');
    expect(assessNeutralSpineProfile({ version: 2 }, now, 1_000).status).toBe('invalid');
    expect(assessNeutralSpineProfile(baseline({ capturedAt: 0 }), now, 1_000).status).toBe('stale');
    const ready = assessNeutralSpineProfile(baseline({ capturedAt: now - 100 }), now, 1_000);
    expect(ready.status).toBe('ready');
    setNeutralSpineProfile(baseline({ capturedAt: 0 }));
    const calibrator = new NeutralSpineCalibrator({
      minFrames: 2,
      minDurationMs: 50,
      maxAgeMs: 1_000,
      maxTrunkLeanDeg: 12,
      minContourConfidence: 0.5,
    });
    const replaced = calibrator.observe(observation({ thoracicSagitta: 0.2, lumbarSagitta: 0.2 }), 0);
    expect(replaced).toBeNull();
    const locked = calibrator.observe(observation({ thoracicSagitta: 0.2, lumbarSagitta: 0.2 }), 80);
    expect(locked?.thoracicSagitta).toBeCloseTo(0.2);
  });
});

describe('posture classification', () => {
  const config = {
    thoracicEnterDelta: 0.01,
    lumbarEnterDelta: 0.01,
    deltaRelease: 0.75,
    minContourConfidence: 0.5,
  };
  const ready = baseline();

  it('names the region that leaves the baseline and ignores forward lean', () => {
    const shared = {
      thoracicConfidence: 0.9,
      lumbarConfidence: 0.9,
      baseline: ready,
      calibration: 'ready' as const,
      latch: OPEN,
      engaged: true,
    };
    expect(classifyPosture({ ...shared, thoracicSagitta: 0.02, lumbarSagitta: 0 }, config).classification).toBe(
      'possible_upper_back_rounding',
    );
    expect(classifyPosture({ ...shared, thoracicSagitta: 0, lumbarSagitta: 0.02 }, config).classification).toBe(
      'possible_lower_back_rounding',
    );
    expect(classifyPosture({ ...shared, thoracicSagitta: 0.02, lumbarSagitta: 0.02 }, config).classification).toBe(
      'possible_combined_rounding',
    );
    expect(classifyPosture({ ...shared, thoracicSagitta: 0.002, lumbarSagitta: 0.002 }, config).classification).toBe(
      'neutral',
    );
  });

  it('withholds a class when the baseline or the contour is missing', () => {
    const result = classifyPosture(
      {
        thoracicSagitta: 0.05,
        lumbarSagitta: 0.05,
        thoracicConfidence: 0.2,
        lumbarConfidence: 0.9,
        baseline: ready,
        calibration: 'ready',
        latch: { thoracic: true, lumbar: false },
        engaged: true,
      },
      config,
    );
    expect(result.classification).toBe('insufficient_tracking');
    expect(result.fault).toBeNull();
    expect(result.latch.thoracic).toBe(true);
    expect(
      classifyPosture(
        {
          thoracicSagitta: 0.05,
          lumbarSagitta: 0.05,
          thoracicConfidence: 0.9,
          lumbarConfidence: 0.9,
          baseline: null,
          calibration: 'missing',
          latch: OPEN,
          engaged: true,
        },
        config,
      ).classification,
    ).toBe('insufficient_tracking');
  });

  it('releases only after the delta falls through the lower threshold', () => {
    const held = classifyPosture(
      {
        thoracicSagitta: 0.008,
        lumbarSagitta: 0,
        thoracicConfidence: 0.9,
        lumbarConfidence: 0.9,
        baseline: ready,
        calibration: 'ready',
        latch: { thoracic: true, lumbar: false },
        engaged: true,
      },
      config,
    );
    expect(held.classification).toBe('possible_upper_back_rounding');
    const released = classifyPosture(
      {
        thoracicSagitta: 0.005,
        lumbarSagitta: 0,
        thoracicConfidence: 0.9,
        lumbarConfidence: 0.9,
        baseline: ready,
        calibration: 'ready',
        latch: held.latch,
        engaged: true,
      },
      config,
    );
    expect(released.fault).toBeNull();
  });
});

describe('deadlift phases', () => {
  const config = {
    engagedTrunkLeanDeg: 20,
    extendedKneeDeg: 155,
    flexedKneeDeg: 140,
  };

  it('follows setup, pull, knee transition, lockout, lowering, and the next pull', () => {
    let state = initialDeadliftPhaseState();
    const script: Array<{ lean: number; knee: number; hipY: number; phase: string }> = [
      { lean: 55, knee: 100, hipY: 0.6, phase: 'setup' },
      { lean: 50, knee: 105, hipY: 0.58, phase: 'initial_pull' },
      { lean: 40, knee: 150, hipY: 0.5, phase: 'knee_transition' },
      { lean: 8, knee: 170, hipY: 0.42, phase: 'lockout' },
      { lean: 35, knee: 145, hipY: 0.5, phase: 'lowering' },
      { lean: 30, knee: 110, hipY: 0.48, phase: 'initial_pull' },
    ];
    for (const step of script) {
      state = stepDeadliftPhase(
        state,
        { trunkLeanDeg: step.lean, kneeIncludedDeg: step.knee, hipY: step.hipY },
        config,
      );
      expect(state.phase, step.phase).toBe(step.phase);
    }
  });
});
