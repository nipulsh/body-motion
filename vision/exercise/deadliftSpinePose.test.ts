import { beforeEach, describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../config';
import {
  getNeutralSpineProfile,
  resetNeutralSpineProfile,
  setNeutralSpineProfile,
  type NeutralSpineProfile,
} from '../posture/NeutralSpineCalibrator';
import { hinge, type HingeOptions } from '../test/deadliftHinge';
import { chainFor, type ChainOptions } from '../test/spineChain';
import type { PoseResult } from '../types';
import { DeadliftFormMonitor, measureDeadliftForm } from './deadliftForm';

const CHAIN = VISION_CONFIG.spinePose.chain;
const STEP = 66;

beforeEach(() => {
  resetNeutralSpineProfile();
});

function withChain(body: HingeOptions, chain: ChainOptions = {}): PoseResult {
  const pose = hinge(body);
  pose.spine = chainFor({ leanDeg: body.leanDeg, facing: body.facing, hipShiftY: body.hipShiftY, ...chain });
  return pose;
}

const STAND: HingeOptions = { leanDeg: 5, kneeBendDeg: 5 };
const HINGE: HingeOptions = { leanDeg: 55, kneeBendDeg: 30 };

class Session {
  readonly monitor = new DeadliftFormMonitor();
  t = 0;
  repCount = 0;
  last: ReturnType<DeadliftFormMonitor['update']> | null = null;

  /** Frames at the 15 fps session rate. Each carries a new keypoint capture unless `reuseCapture`. */
  run(durationMs: number, body: HingeOptions, chain: ChainOptions | null, reuseCapture = false) {
    const seen = [];
    const end = this.t + durationMs;
    for (; this.t < end; this.t += STEP) {
      const pose = hinge(body);
      if (chain) {
        pose.spine = chainFor({
          leanDeg: body.leanDeg,
          facing: body.facing,
          ...chain,
          capturedAt: reuseCapture ? (chain.capturedAt ?? 0) : this.t,
        });
      }
      this.last = this.monitor.update(pose, this.t, this.repCount, pose.frameAspect);
      seen.push(this.last);
    }
    return seen;
  }

  calibrate() {
    return this.run(800, STAND, {});
  }

  get frame() {
    return this.last!.frame!;
  }
}

describe('measureDeadliftForm with SpinePose keypoints', () => {
  it('sees the bend from the keypoints even when the outline looks flat', () => {
    const frame = measureDeadliftForm(withChain(HINGE, { bulge: 0.1 }))!;
    expect(frame.spineSource).toBe('spinepose');
    expect(frame.thoracic.sagitta).toBeCloseTo(0.1, 4);
    expect(frame.lumbar.sagitta).toBeCloseTo(0.1, 4);
    expect(frame.backCheck).toBe('judged');
    expect(frame.backBendDeg).toBeGreaterThan(15);
  });

  it('does not need a body outline at all', () => {
    const frame = measureDeadliftForm(withChain({ ...HINGE, silhouette: false }, { bulge: 0.1 }))!;
    expect(frame.backCheck).toBe('judged');
    expect(frame.spineCurve.status).toBe('measured');
  });

  it('draws the spine through the keypoints themselves, pelvis first', () => {
    const pose = withChain(HINGE, { bulge: 0.1 });
    const frame = measureDeadliftForm(pose)!;
    expect(frame.spineCurve.points).toHaveLength(8);
    frame.spineCurve.points.forEach((point, index) => {
      expect(point.x).toBeCloseTo(pose.spine!.points[index]!.x, 6);
      expect(point.y).toBeCloseTo(pose.spine!.points[index]!.y, 6);
      expect(point.source).toBe('measured');
    });
    expect(frame.spineCurve.origin).toBe('spinepose');
    expect(frame.spineCurve.lumbar.sagitta).toBeCloseTo(0.1, 4);
    expect(frame.spineCurve.upperThoracic.sagitta).toBeCloseTo(0.1, 4);
    expect(frame.spineCurve.overall.sagitta).toBeCloseTo(0.1, 4);
  });

  it('leaves trunk lean, back angle, and the hip angle on the MediaPipe landmarks', () => {
    const plain = measureDeadliftForm(hinge(HINGE))!;
    const rounded = measureDeadliftForm(withChain(HINGE, { bulge: 0.12 }))!;
    expect(rounded.trunkLeanDeg).toBe(plain.trunkLeanDeg);
    expect(rounded.backAngleDeg).toBe(plain.backAngleDeg);
    expect(rounded.hipAngleDeg).toBe(plain.hipAngleDeg);
  });

  it('reads the same for a person facing the other way', () => {
    const right = measureDeadliftForm(withChain({ ...HINGE, facing: 'right' }, { bulge: 0.08 }))!;
    const left = measureDeadliftForm(withChain({ ...HINGE, facing: 'left' }, { bulge: 0.08 }))!;
    expect(left.lumbar.sagitta).toBeCloseTo(right.lumbar.sagitta!, 5);
    expect(left.thoracic.sagitta).toBeCloseTo(right.thoracic.sagitta!, 5);
  });

  it('uses the outline when there are no keypoints, exactly as before', () => {
    const frame = measureDeadliftForm(hinge({ ...HINGE, bendDeg: 45 }))!;
    expect(frame.spineSource).toBe('outline');
    expect(frame.spineCurve.origin).toBe('outline');
    expect(frame.backCheck).toBe('judged');
    expect(frame.thoracic.sagitta).toBeGreaterThan(0);
  });

  it('falls to the outline when the keypoints fail their checks', () => {
    const frame = measureDeadliftForm(withChain({ ...HINGE, bendDeg: 45 }, { score: 0.1 }))!;
    expect(frame.spineSource).toBe('outline');
    expect(frame.spineRejection).toBe('low_confidence');
  });

  it('does not read the back from a camera that is not side-on', () => {
    const pose = withChain(HINGE, { bulge: 0.1 });
    const lm = pose.landmarks;
    const set = (i: number, x: number, y: number) => {
      lm[i] = { x, y, z: 0, visibility: 0.95 };
    };
    set(11, 0.35, 0.3);
    set(12, 0.65, 0.3);
    set(23, 0.42, 0.65);
    set(24, 0.58, 0.65);
    const frame = measureDeadliftForm(pose)!;
    expect(frame.backCheck).toBe('not_side_on');
    expect(frame.thoracic.sagitta).toBeNull();
    expect(frame.lumbar.sagitta).toBeNull();
  });

  it('with a known facing direction, reads a chain even when no landmark says which way the person faces', () => {
    const pose = withChain(HINGE, { bulge: 0.1 });
    // Only hip and shoulder remain: no face, feet, or knee to vote on the chest side.
    for (let i = 0; i < pose.landmarks.length; i += 1) {
      if (![11, 23].includes(i)) pose.landmarks[i] = { x: 0, y: 0, z: 0, visibility: 0 };
    }
    const unknown = measureDeadliftForm(pose)!;
    expect(unknown.spineRejection).toBe('no_direction');
    const remembered = measureDeadliftForm(pose, undefined, { chestSign: unknown.chestSign ?? 1 })!;
    expect(remembered.spineSource).toBe('spinepose');
  });
});

describe('DeadliftFormMonitor with SpinePose keypoints', () => {
  it('warns about a rounded back that the outline cannot see', () => {
    const s = new Session();
    s.calibrate();
    expect(s.frame.calibration).toBe('ready');
    const seen = s.run(2000, HINGE, { bulge: 0.1 });
    expect(seen.some((r) => r.faults.some((f) => f.code === 'possible_combined_rounding' && f.sustained))).toBe(true);
    expect(s.frame.rounded).toBe(true);
    expect(s.frame.spineSource).toBe('spinepose');
  });

  it('stays clear for a flat-back hinge, however far the trunk leans', () => {
    const s = new Session();
    s.calibrate();
    for (const leanDeg of [30, 55, 80]) {
      const seen = s.run(1800, { ...HINGE, leanDeg }, {});
      expect(seen.every((r) => r.faults.length === 0)).toBe(true);
    }
    expect(s.frame.classification).toBe('neutral');
  });

  it('names the lower back when only the lumbar stations bend', () => {
    const s = new Session();
    s.calibrate();
    s.run(2000, HINGE, { lumbarBulge: 0.12 });
    expect(s.last!.faults.map((f) => f.code)).toContain('possible_lower_back_rounding');
  });

  it('names the upper back when only the thoracic stations bend', () => {
    const s = new Session();
    s.calibrate();
    s.run(2000, HINGE, { thoracicBulge: 0.12 });
    expect(s.last!.faults.map((f) => f.code)).toContain('possible_upper_back_rounding');
  });

  it('applies the keypoint threshold, not the outline one: the model reads about a third of a true bend', () => {
    expect(CHAIN.lumbarEnterDelta).toBeLessThan(VISION_CONFIG.deadliftForm.lumbarEnterDelta);
    const under = new Session();
    under.calibrate();
    // A whole-back bulge reaches the shoulder/neck side too, which is the more sensitive one.
    const quiet = under.run(2000, HINGE, { bulge: Math.min(CHAIN.thoracicEnterDelta, CHAIN.lumbarEnterDelta) - 0.01 });
    expect(quiet.every((r) => r.faults.length === 0)).toBe(true);

    resetNeutralSpineProfile();
    const over = new Session();
    over.calibrate();
    // Past the keypoint threshold while still under the outline one.
    over.run(2000, HINGE, { bulge: CHAIN.lumbarEnterDelta + 0.01 });
    expect(over.last!.faults.length).toBeGreaterThan(0);
  });

  it('measures against the person: a back that is always this curved is their baseline, not a fault', () => {
    const s = new Session();
    s.run(800, STAND, { bulge: 0.06 });
    expect(s.frame.calibration).toBe('ready');
    const seen = s.run(2000, HINGE, { bulge: 0.06 });
    expect(seen.every((r) => r.faults.length === 0)).toBe(true);
  });

  it('needs a standing baseline before it will warn', () => {
    const s = new Session();
    const seen = s.run(2500, HINGE, { bulge: 0.15 });
    expect(seen.every((r) => r.faults.length === 0)).toBe(true);
    expect(s.frame.calibration).toBe('missing');
    expect(s.frame.classification).toBe('insufficient_tracking');
  });

  it('does not warn while upright, even if the chain bends', () => {
    const s = new Session();
    s.calibrate();
    const seen = s.run(2000, STAND, { bulge: 0.12 });
    expect(seen.every((r) => r.faults.length === 0)).toBe(true);
  });

  it('scores a rounded rep incorrect and a flat one correct', () => {
    const bad = new Session();
    bad.calibrate();
    bad.run(2000, HINGE, { bulge: 0.1 });
    bad.repCount = 1;
    bad.run(600, STAND, {});
    expect(bad.last).toMatchObject({ correctReps: 0, incorrectReps: 1 });

    resetNeutralSpineProfile();
    const good = new Session();
    good.calibrate();
    good.run(2000, HINGE, {});
    good.repCount = 1;
    good.run(600, STAND, {});
    expect(good.last).toMatchObject({ correctReps: 1, incorrectReps: 0 });
  });

  it('reports the bend against the baseline in degrees', () => {
    const s = new Session();
    s.calibrate();
    s.run(1500, HINGE, {});
    expect(Math.abs(s.frame.spineBendDeltaDeg!)).toBeLessThan(1);
    s.run(1500, HINGE, { bulge: 0.1 });
    expect(s.frame.spineBendDeltaDeg!).toBeGreaterThan(15);
  });

  it('calibrates and warns on a slow machine that returns keypoints every 300 ms', () => {
    const s = new Session();
    let capture = 0;
    const slowRun = (duration: number, body: HingeOptions, chain: ChainOptions) => {
      const end = s.t + duration;
      for (; s.t < end; s.t += STEP) {
        if (s.t - capture >= 300) capture = s.t;
        const pose = hinge(body);
        pose.spine = chainFor({ leanDeg: body.leanDeg, ...chain, capturedAt: capture });
        s.last = s.monitor.update(pose, s.t, 0, pose.frameAspect);
      }
    };
    slowRun(3500, STAND, {});
    expect(s.frame.calibration).toBe('ready');
    slowRun(2500, HINGE, { bulge: 0.1 });
    expect(s.last!.faults.length).toBeGreaterThan(0);
  });

  it('sets a baseline from about half a second of standing at the rate the model really runs', () => {
    // 10 results a second, as measured on real hardware. A patient may start hinging almost at once.
    const s = new Session();
    let capture = 0;
    const end = 650;
    for (; s.t < end; s.t += STEP) {
      if (s.t - capture >= 100) capture = s.t;
      const pose = hinge(STAND);
      pose.spine = chainFor({ leanDeg: STAND.leanDeg, capturedAt: capture });
      s.last = s.monitor.update(pose, s.t, 0, pose.frameAspect);
    }
    expect(s.frame.calibration).toBe('ready');
    expect(getNeutralSpineProfile('spinepose')?.sampleCount).toBeGreaterThanOrEqual(VISION_CONFIG.spinePose.chain.calibrationMinCaptures);
  });

  it('still does not take a baseline from a single repeated result', () => {
    const s = new Session();
    s.run(1500, STAND, { capturedAt: 777 }, true);
    expect(s.frame.calibration).toBe('missing');
  });

  it('counts captures, not frames: one bad result repeated by a stalled model cannot open a warning', () => {
    const s = new Session();
    s.calibrate();
    s.run(300, HINGE, {});
    const seen = s.run(2000, HINGE, { bulge: 0.2, capturedAt: 123456 }, true);
    expect(seen.every((r) => r.faults.length === 0)).toBe(true);
  });
});

describe('DeadliftFormMonitor baselines', () => {
  const OUTLINE: NeutralSpineProfile = {
    version: 1,
    capturedAt: Date.now(),
    thoracicSagitta: -0.3,
    lumbarSagitta: -0.3,
    trunkLeanDeg: 4,
    hipAngleDeg: 170,
    hipShoulderScale: 0.3,
    sampleCount: 8,
  };

  it('never compares keypoints with an outline baseline', () => {
    setNeutralSpineProfile(OUTLINE);
    const s = new Session();
    const seen = s.run(2000, HINGE, {});
    expect(s.frame.calibration).toBe('missing');
    expect(seen.every((r) => r.faults.length === 0)).toBe(true);
    expect(getNeutralSpineProfile()).toEqual(OUTLINE);
  });

  it('keeps a keypoint baseline apart from the outline baseline', () => {
    const s = new Session();
    s.calibrate();
    expect(getNeutralSpineProfile('spinepose')?.source).toBe('spinepose');
    expect(getNeutralSpineProfile()).toBeNull();
  });

  it('keeps the baseline for the next set', () => {
    const first = new Session();
    first.calibrate();
    const next = new Session();
    next.run(1800, HINGE, { bulge: 0.1 });
    expect(next.last!.faults.length).toBeGreaterThan(0);
  });
});

describe('DeadliftFormMonitor when keypoints come and go', () => {
  it('a short dropout is not filled in from the outline and cannot warn', () => {
    const s = new Session();
    s.calibrate();
    s.run(1000, HINGE, {});
    // The outline would read rounded here; the keypoints have only just gone missing.
    const seen = s.run(CHAIN.holdMs - 200, { ...HINGE, bendDeg: 60 }, null);
    expect(seen.every((r) => r.frame?.spineSource === 'spinepose')).toBe(true);
    expect(seen.every((r) => r.frame?.thoracic.sagitta === null)).toBe(true);
    expect(seen.every((r) => r.faults.length === 0)).toBe(true);
    expect(s.frame.classification).toBe('insufficient_tracking');
  });

  it('a rejected chain counts as a dropout too', () => {
    const s = new Session();
    s.calibrate();
    s.run(500, HINGE, {});
    s.run(300, HINGE, { score: 0.05 });
    expect(s.frame.spineSource).toBe('spinepose');
    expect(s.frame.thoracic.sagitta).toBeNull();
    expect(s.frame.spineRejection).toBe('low_confidence');
  });

  it('after a long dropout it returns to the outline, and needs the outline baseline', () => {
    const s = new Session();
    s.calibrate();
    s.run(500, HINGE, {});
    s.run(CHAIN.holdMs + 300, HINGE, null);
    expect(s.frame.spineSource).toBe('outline');
    expect(s.frame.calibration).toBe('missing');
    s.run(800, STAND, null);
    expect(getNeutralSpineProfile()).not.toBeNull();
    expect(s.frame.calibration).toBe('ready');
  });

  it('dropping back does not carry an open warning across scales', () => {
    const s = new Session();
    s.calibrate();
    s.run(2000, HINGE, { bulge: 0.1 });
    expect(s.frame.rounded).toBe(true);
    const seen = s.run(CHAIN.holdMs + 600, HINGE, null);
    expect(seen[seen.length - 1]!.frame?.spineSource).toBe('outline');
    expect(seen[seen.length - 1]!.frame?.rounded).toBe(false);
  });

  it('switches to keypoints when the model finishes loading mid-set', () => {
    const s = new Session();
    s.run(800, STAND, null);
    expect(s.frame.spineSource).toBe('outline');
    s.run(800, STAND, {});
    expect(s.frame.spineSource).toBe('spinepose');
    expect(s.frame.calibration).toBe('ready');
    s.run(2000, HINGE, { bulge: 0.1 });
    expect(s.last!.faults.length).toBeGreaterThan(0);
  });

  it('facing the camera for a moment pauses the reading, then it resumes on the next side-on frame', () => {
    const s = new Session();
    s.calibrate();
    s.run(500, HINGE, {});
    expect(s.frame.backCheck).toBe('judged');
    for (let i = 0; i < 6; i += 1) {
      const pose = withChain(HINGE, { capturedAt: s.t });
      const put = (index: number, x: number, y: number) => {
        pose.landmarks[index] = { x, y, z: 0, visibility: 0.95 };
      };
      put(11, 0.35, 0.3);
      put(12, 0.65, 0.3);
      put(23, 0.42, 0.65);
      put(24, 0.58, 0.65);
      s.last = s.monitor.update(pose, s.t, 0, pose.frameAspect);
      s.t += STEP;
    }
    expect(s.frame.backCheck).toBe('not_side_on');
    expect(s.frame.thoracic.sagitta).toBeNull();
    expect(s.last!.faults).toEqual([]);
    s.run(800, HINGE, {});
    expect(s.frame.backCheck).toBe('judged');
    expect(s.frame.spineSource).toBe('spinepose');
    expect(s.frame.calibration).toBe('ready');
  });
});
