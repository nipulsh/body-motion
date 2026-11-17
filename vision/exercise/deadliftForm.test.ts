import { beforeEach, describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import { resetNeutralSpineProfile } from '../posture/NeutralSpineCalibrator';
import { H, hinge, poseFrom, W } from '../test/deadliftHinge';
import { formScoresReps } from './exerciseForm';
import { DeadliftFormMonitor, measureDeadliftForm } from './deadliftForm';

beforeEach(() => {
  resetNeutralSpineProfile();
});

/** Stand side-on long enough to lock a flat baseline, then hold `pose`. */
function afterBaseline(pose: () => ReturnType<typeof hinge>, holdMs = 800) {
  const monitor = new DeadliftFormMonitor();
  let t = 0;
  for (let i = 0; i < 12; i += 1) {
    monitor.update(hinge({ leanDeg: 6 }), t, 0);
    t += 66;
  }
  let result = monitor.update(pose(), t, 0);
  const until = t + holdMs;
  for (t += 66; t <= until; t += 66) result = monitor.update(pose(), t, 0);
  return result;
}

const HINGE = poseFrom({
  leftHip: [0.3, 0.5],
  leftShoulder: [0.6, 0.35],
  leftEar: [0.7, 0.3],
  rightHip: [0.31, 0.5, 0.3],
  rightShoulder: [0.61, 0.35, 0.3],
});

describe('measureDeadliftForm', () => {
  it('places four back points from hip to shoulder on the camera-facing side, then the head', () => {
    const frame = measureDeadliftForm(HINGE)!;
    expect(frame.side).toBe('left');
    expect(frame.back).toHaveLength(4);
    expect(frame.back[0]).toEqual({ x: 0.3, y: 0.5 });
    expect(frame.back[1]!.x).toBeCloseTo(0.4);
    expect(frame.back[1]!.y).toBeCloseTo(0.45);
    expect(frame.back[2]!.x).toBeCloseTo(0.5);
    expect(frame.back[3]).toEqual({ x: 0.6, y: 0.35 });
    expect(frame.head).toEqual({ x: 0.7, y: 0.3 });
  });

  it('needs the hip and shoulder; the head is optional', () => {
    expect(measureDeadliftForm(poseFrom({ leftHip: [0.3, 0.5], leftShoulder: [0.6, 0.35, 0.2] }))).toBeNull();
    expect(measureDeadliftForm(poseFrom({ leftHip: [0.3, 0.5], leftShoulder: [0.6, 0.35] }))!.head).toBeNull();
  });

  it('reads the back angle from the vertical at the hip: 0° upright, larger as the hinge deepens', () => {
    expect(measureDeadliftForm(hinge({ leanDeg: 50 }))!.backAngleDeg).toBeCloseTo(50, 0);
    expect(measureDeadliftForm(hinge({ leanDeg: 80 }))!.backAngleDeg).toBeCloseTo(80, 0);
    expect(measureDeadliftForm(hinge({ facing: 'left', leanDeg: 50 }))!.backAngleDeg).toBeCloseTo(50, 0);
    expect(measureDeadliftForm(hinge({ leanDeg: 6 }))!.backAngleDeg).toBeCloseTo(6, 0);
  });

  it('keeps the vertical at the hip upright even with the back nearly flat', () => {
    const monitor = new DeadliftFormMonitor();
    for (let i = 0; i < 10; i += 1) {
      expect(monitor.update(hinge({ leanDeg: 85 }), i * 33, 0).frame!.upImage).toEqual({ x: 0, y: -1 });
    }
  });

  it('reads a flat back as straight and traces its outline', () => {
    const frame = measureDeadliftForm(hinge())!;
    expect(frame.trunkLeanDeg).toBeCloseTo(50, 0);
    expect(frame.backBulgeRatio).not.toBeNull();
    expect(Math.abs(frame.backBulgeRatio!)).toBeLessThan(0.01);
    expect(frame.rounded).toBe(false);
    expect(frame.spineBow).toEqual({ x: 0, y: 0 });
    expect(frame.backEdge.length).toBeGreaterThanOrEqual(10);
    // Facing right and hinged, the back faces up and to the left of the trunk line.
    const hip = frame.back[0]!;
    for (const point of frame.backEdge) {
      expect(point.x * W).toBeLessThan(hip.x * W + 110);
      expect(point.y * H).toBeLessThan(hip.y * H);
    }
  });

  it('flags a rounded outline and bends the back line out of the back', () => {
    const frame = afterBaseline(() => hinge({ bulgePx: 20 })).frame!;
    expect(frame.backBulgeRatio!).toBeGreaterThan(0.05);
    expect(frame.rounded).toBe(true);
    expect(frame.classification).toBe('possible_combined_rounding');
    expect(frame.spineBow.x).toBeLessThan(0);
    expect(frame.spineBow.y).toBeLessThan(0);
    const hip = frame.back[0]!;
    const shoulder = frame.back[3]!;
    const straight = { x: hip.x + (shoulder.x - hip.x) / 3, y: hip.y + (shoulder.y - hip.y) / 3 };
    expect(frame.back[1]!.x).toBeLessThan(straight.x);
    expect(frame.back[1]!.y).toBeLessThan(straight.y);
  });

  it('bends out of the back when the patient faces the other way', () => {
    const frame = afterBaseline(() => hinge({ facing: 'left', bulgePx: 20 })).frame!;
    expect(frame.side).toBe('right');
    expect(frame.rounded).toBe(true);
    expect(frame.spineBow.x).toBeGreaterThan(0);
    expect(frame.spineBow.y).toBeLessThan(0);
  });

  it('lets a slight natural curve pass', () => {
    const frame = measureDeadliftForm(hinge({ bulgePx: 5 }))!;
    expect(frame.backBulgeRatio!).toBeGreaterThan(0);
    expect(frame.rounded).toBe(false);
  });

  it('reports the back bend in degrees: about 0° flat, close to the true bend when rounded', () => {
    expect(Math.abs(measureDeadliftForm(hinge())!.backBendDeg!)).toBeLessThan(3);
    for (const bendDeg of [20, 30, 45, 60]) {
      const frame = measureDeadliftForm(hinge({ bendDeg }))!;
      expect(frame.backBendDeg!, `${bendDeg}°`).toBeGreaterThan(bendDeg - 4);
      expect(frame.backBendDeg!, `${bendDeg}°`).toBeLessThan(bendDeg + 4);
    }
  });

  it('does not treat a fixed bend as rounded until it exceeds the standing baseline', () => {
    for (const bendDeg of [30, 45]) {
      for (const facing of ['right', 'left'] as const) {
        const frame = afterBaseline(() => hinge({ bendDeg, facing })).frame!;
        expect(frame.rounded, `${bendDeg}° facing ${facing} lumbar ${frame.lumbar.delta} thoracic ${frame.thoracic.delta}`).toBe(true);
        expect(frame.backCheck).toBe('judged');
        expect(frame.classification === 'possible_combined_rounding' || frame.classification === 'possible_lower_back_rounding' || frame.classification === 'possible_upper_back_rounding', frame.classification).toBe(true);
      }
    }
  });

  it('does not call a forward hinge with a flat outline rounded', () => {
    const result = afterBaseline(() => hinge({ leanDeg: 70 }));
    expect(result.frame!.trunkInclinationDeg).toBeGreaterThan(60);
    expect(result.frame!.classification).toBe('neutral');
    expect(result.frame!.rounded).toBe(false);
    expect(result.faults).toEqual([]);
  });

  it('separates an upper-back bulge from a lower-back bulge', () => {
    const upper = measureDeadliftForm(hinge({ thoracicBulgePx: 26 }))!;
    const lower = measureDeadliftForm(hinge({ lumbarBulgePx: 26 }))!;
    expect(upper.thoracic.sagitta!).toBeGreaterThan((upper.lumbar.sagitta ?? 0) + 0.005);
    expect(lower.lumbar.sagitta!).toBeGreaterThan((lower.thoracic.sagitta ?? 0) + 0.005);
    const warnedUpper = afterBaseline(() => hinge({ thoracicBulgePx: 26 })).frame!;
    const warnedLower = afterBaseline(() => hinge({ lumbarBulgePx: 26 })).frame!;
    expect(warnedUpper.classification).toBe('possible_upper_back_rounding');
    expect(warnedLower.classification).toBe('possible_lower_back_rounding');
  });

  it('keeps the same normalized sagitta when the body is drawn larger', () => {
    const small = measureDeadliftForm(hinge({ lumbarBulgePx: 24 }))!;
    const large = measureDeadliftForm(hinge({ lumbarBulgePx: 24, scale: 2 }))!;
    expect(Math.abs(large.lumbar.sagitta! - small.lumbar.sagitta!)).toBeLessThan(0.05);
    expect(Math.abs(large.thoracic.sagitta! - small.thoracic.sagitta!)).toBeLessThan(0.05);
  });

  it('rejects a hidden knee for curvature and still reports trunk lean', () => {
    const frame = measureDeadliftForm(hinge({ hideKnee: true }))!;
    expect(frame.backCheck).toBe('landmarks_missing');
    expect(frame.view.landmarksVisible).toBe(false);
    expect(frame.thoracic.sagitta).toBeNull();
    expect(frame.lumbar.sagitta).toBeNull();
    expect(frame.trunkInclinationDeg).toBeGreaterThan(40);
    expect(frame.rounded).toBe(false);
  });

  it('trusts plausible world landmarks and lowers confidence when their scale is not', () => {
    const plausible = measureDeadliftForm(hinge({ worldTorsoM: 0.45 }))!;
    const implausible = measureDeadliftForm(hinge({ worldTorsoM: 4 }))!;
    expect(plausible.worldLandmarksReliable).toBe(true);
    expect(implausible.worldLandmarksReliable).toBe(false);
    expect(implausible.landmarkConfidence).toBeLessThan(plausible.landmarkConfidence);
    expect(implausible.backCheck).toBe('judged');
    expect(implausible.trunkInclinationDeg).toBeCloseTo(plausible.trunkInclinationDeg, 0);
  });

  it('does not flag a flat back or a natural S-shaped spine', () => {
    expect(measureDeadliftForm(hinge())!.rounded).toBe(false);
    const natural = measureDeadliftForm(hinge({ sCurvePx: 4 }))!;
    expect(natural.rounded).toBe(false);
    expect(Math.abs(natural.backBendDeg!)).toBeLessThan(12);
  });

  it('does not call a hollow (arched) back rounded', () => {
    const frame = measureDeadliftForm(hinge({ bulgePx: -8 }))!;
    expect(frame.backBendDeg!).toBeLessThan(0);
    expect(frame.rounded).toBe(false);
  });

  it('says why the back is not judged instead of staying silent', () => {
    expect(measureDeadliftForm(hinge())!.backCheck).toBe('judged');
    expect(measureDeadliftForm(hinge({ leanDeg: 6 }))!.backCheck).toBe('upright');
    expect(measureDeadliftForm(hinge({ silhouette: false }))!.backCheck).toBe('no_silhouette');
    const front = hinge({ bendDeg: 40 });
    const lm = front.landmarks;
    const at = (name: PoseLandmarkName) => lm[POSE_LANDMARK_INDEX[name]]!;
    lm[POSE_LANDMARK_INDEX.rightShoulder] = { ...at('leftShoulder'), x: at('leftShoulder').x + 0.2, visibility: 0.95 };
    lm[POSE_LANDMARK_INDEX.rightHip] = { ...at('leftHip'), x: at('leftHip').x + 0.2, visibility: 0.95 };
    expect(measureDeadliftForm(front)!.backCheck).toBe('not_side_on');
    const empty = hinge();
    empty.silhouette = { ...empty.silhouette!, data: new Uint8Array(empty.silhouette!.data.length) };
    expect(measureDeadliftForm(empty)!.backCheck).toBe('outline_unavailable');
    expect(measureDeadliftForm(empty)!.view.landmarksVisible).toBe(true);
    expect(measureDeadliftForm(empty)!.view.cameraSideOn).toBe(true);
    const standing = measureDeadliftForm(hinge({ leanDeg: 6 }))!;
    const hinged = measureDeadliftForm(hinge({ leanDeg: 70 }))!;
    expect(standing.view.landmarksVisible).toBe(hinged.view.landmarksVisible);
    expect(hinged.backCheck).not.toBe('landmarks_missing');
  });

  it('ignores the arms, hands, bar and gaze while the back outline stays straight', () => {
    for (const options of [
      { shoulderShiftPx: 12 },
      { shoulderShiftPx: -8 },
      { kneeShiftPx: [18, -25] as [number, number] },
      { headDown: true },
      { shoulderShiftPx: 12, kneeShiftPx: [18, -25] as [number, number], headDown: true },
    ]) {
      const frame = measureDeadliftForm(hinge(options))!;
      expect(frame.rounded, JSON.stringify(options)).toBe(false);
      expect(Math.abs(frame.backBulgeRatio!), JSON.stringify(options)).toBeLessThan(0.015);
      expect(frame.spineBow).toEqual({ x: 0, y: 0 });
    }
  });

  it('shrugs off a stray blob touching the back', () => {
    const frame = measureDeadliftForm(hinge({ blob: true }))!;
    expect(frame.rounded).toBe(false);
    expect(Math.abs(frame.backBulgeRatio!)).toBeLessThan(0.02);
  });

  it('does not judge the back without a silhouette, standing, or facing the camera', () => {
    const noOutline = measureDeadliftForm(hinge({ bulgePx: 20, headDown: true, shoulderShiftPx: 15, silhouette: false }))!;
    expect(noOutline.backBulgeRatio).toBeNull();
    expect(noOutline.rounded).toBe(false);
    expect(noOutline.backEdge).toEqual([]);

    const standing = measureDeadliftForm(hinge({ leanDeg: 6, bulgePx: 20 }))!;
    expect(standing.backBulgeRatio).toBeNull();
    expect(standing.rounded).toBe(false);

    const front = hinge({ bulgePx: 20 });
    const left = front.landmarks;
    const at = (name: PoseLandmarkName) => left[POSE_LANDMARK_INDEX[name]]!;
    left[POSE_LANDMARK_INDEX.rightShoulder] = { ...at('leftShoulder'), x: at('leftShoulder').x + 0.2, visibility: 0.95 };
    left[POSE_LANDMARK_INDEX.rightHip] = { ...at('leftHip'), x: at('leftHip').x + 0.2, visibility: 0.95 };
    expect(measureDeadliftForm(front)!.rounded).toBe(false);
  });
});

describe('DeadliftFormMonitor', () => {
  it('warns once a rounded outline has held, scores the rep, and clears on a flat outline', () => {
    const monitor = new DeadliftFormMonitor();
    let t = 0;
    for (let i = 0; i < 12; i += 1) {
      monitor.update(hinge({ leanDeg: 6 }), t, 0);
      t += 66;
    }
    let result = monitor.update(hinge({ bulgePx: 20 }), t, 0);
    const roundedUntil = t + 1600;
    for (t += 66; t <= roundedUntil; t += 66) result = monitor.update(hinge({ bulgePx: 20 }), t, 0);
    expect(result.frame!.rounded).toBe(true);
    expect(result.faults[0]).toMatchObject({ code: 'possible_combined_rounding', sustained: true });
    const scored = monitor.update(hinge({ bulgePx: 20 }), t, 1);
    expect(scored.incorrectReps).toBe(1);
    expect(scored.correctReps).toBe(0);
    expect(formScoresReps({ kind: 'deadlift', ...scored })).toBe(true);

    t += 66;
    for (let i = 0; i < 20; i += 1) {
      result = monitor.update(hinge(), t, 1);
      t += 66;
    }
    expect(result.frame!.rounded).toBe(false);
    expect(result.frame!.spineBow).toEqual({ x: 0, y: 0 });
    expect(result.faults).toEqual([]);
  });

  it('ignores a single spiked frame and sustains a held change', () => {
    const monitor = new DeadliftFormMonitor();
    let t = 0;
    for (let i = 0; i < 12; i += 1) {
      monitor.update(hinge({ leanDeg: 6 }), t, 0);
      t += 66;
    }
    for (let i = 0; i < 4; i += 1) {
      monitor.update(hinge(), t, 0);
      t += 66;
    }
    expect(monitor.update(hinge({ bendDeg: 70 }), t, 0).frame!.rounded).toBe(false);
    t += 66;
    expect(monitor.update(hinge(), t, 0).frame!.rounded).toBe(false);
    expect(monitor.update(hinge(), t + 66, 0).faults).toEqual([]);

    let result = monitor.update(hinge({ bendDeg: 45 }), t + 132, 0);
    for (let step = t + 198; step <= t + 1800; step += 66) result = monitor.update(hinge({ bendDeg: 45 }), step, 0);
    expect(result.frame!.rounded).toBe(true);
    expect(result.faults[0]).toMatchObject({ code: 'possible_combined_rounding', sustained: true });
  });

  it('does not warn without a baseline, and does not score an unjudged rep correct', () => {
    const monitor = new DeadliftFormMonitor();
    let t = 0;
    for (; t <= 800; t += 66) monitor.update(hinge({ bendDeg: 45, silhouette: false }), t, 0);
    const done = monitor.update(hinge({ leanDeg: 8, silhouette: false }), t, 1);
    expect(done.frame!.classification).toBe('insufficient_tracking');
    expect(done.faults).toEqual([]);
    expect(done.correctReps).toBe(0);
    expect(done.incorrectReps).toBe(0);
  });

  it('keeps a flat back straight whatever the arms do', () => {
    const monitor = new DeadliftFormMonitor();
    let t = 0;
    for (let i = 0; i < 12; i += 1) {
      monitor.update(hinge({ leanDeg: 6 }), t, 0);
      t += 66;
    }
    const shifts = [0, 6, 12, 4, -6, 10, 14, 2];
    for (const shift of shifts) {
      const result = monitor.update(hinge({ shoulderShiftPx: shift, kneeShiftPx: [shift, -shift] }), t, 0);
      t += 66;
      expect(result.frame!.rounded).toBe(false);
      expect(result.faults).toEqual([]);
    }
  });
});
