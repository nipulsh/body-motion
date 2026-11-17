import { describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../types';
import { measureSquatForm, SquatFormMonitor } from './squatForm';

type Body = Partial<Record<PoseLandmarkName, [number, number, number]>>;

/**
 * World-space pose (metres, y down, hip-centred) and the camera image of it: a square frame at
 * half scale, so image angles equal the world angles in the camera plane.
 */
function poseFrom(body: Body, timestamp = 0): PoseResult {
  const world: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y, z]] of Object.entries(body) as [PoseLandmarkName, [number, number, number]][]) {
    world[POSE_LANDMARK_INDEX[name]] = { x, y, z, visibility: 0.99 };
  }
  const landmarks = world.map((lm) => ({ ...lm, x: lm.x / 2 + 0.5, y: lm.y / 2 + 0.5 }));
  return { landmarks, worldLandmarks: world, confidence: 0.99, timestamp, frameAspect: 1 };
}

const FRONT_SQUAT: Body = {
  leftShoulder: [0.2, -0.15, 0.1],
  rightShoulder: [-0.2, -0.15, 0.1],
  leftHip: [0.12, 0.35, 0.3],
  rightHip: [-0.12, 0.35, 0.3],
  leftKnee: [0.14, 0.5, -0.15],
  rightKnee: [-0.14, 0.5, -0.15],
  leftAnkle: [0.13, 0.9, 0],
  rightAnkle: [-0.13, 0.9, 0],
  leftHeel: [0.13, 0.95, 0.05],
  rightHeel: [-0.13, 0.95, 0.05],
  leftFootIndex: [0.15, 0.95, -0.12],
  rightFootIndex: [-0.15, 0.95, -0.12],
};

const FRONT_STANDING: Body = {
  ...FRONT_SQUAT,
  leftShoulder: [0.2, -0.5, 0],
  rightShoulder: [-0.2, -0.5, 0],
  leftHip: [0.12, 0, 0],
  rightHip: [-0.12, 0, 0],
  leftKnee: [0.13, 0.45, 0],
  rightKnee: [-0.13, 0.45, 0],
};

const KNEES_CAVING: Body = {
  ...FRONT_SQUAT,
  leftKnee: [0.02, 0.5, -0.15],
  rightKnee: [-0.02, 0.5, -0.15],
};

/** Facing +x, seen side-on: left and right only differ in depth. */
function sideBody(overrides: Partial<Record<'shoulder' | 'hip' | 'knee', [number, number]>> = {}): Body {
  const at = (xy: [number, number], z: number): [number, number, number] => [xy[0], xy[1], z];
  const shoulder = overrides.shoulder ?? [-0.05, -0.15];
  const hip = overrides.hip ?? [-0.25, 0.35];
  const knee = overrides.knee ?? [0.2, 0.5];
  const body: Body = {};
  for (const [side, z] of [['left', 0.1], ['right', -0.1]] as const) {
    body[`${side}Shoulder`] = at(shoulder, z * 2);
    body[`${side}Hip`] = at(hip, z);
    body[`${side}Knee`] = at(knee, z);
    body[`${side}Ankle`] = at([0, 0.9], z);
    body[`${side}Heel`] = at([-0.05, 0.95], z);
    body[`${side}FootIndex`] = at([0.15, 0.95], z);
  }
  return body;
}

describe('measureSquatForm', () => {
  it('reads a good front-view squat with knees on their heel lines', () => {
    const frame = measureSquatForm(poseFrom(FRONT_SQUAT))!;
    expect(frame.view).toBe('front');
    expect(frame.engaged).toBe(true);
    expect(frame.kneeAngle.left).toBeGreaterThan(80);
    expect(frame.kneeAngle.left).toBeLessThan(100);
    expect(frame.kneeLines).toHaveLength(2);
    expect(frame.faults).toEqual([]);
  });

  it('keeps a front-on squat leaning toward the camera in front view', () => {
    // Chest well forward of the hips in depth: a 3D torso length made this read side-on.
    const leaning: Body = {
      ...FRONT_SQUAT,
      leftShoulder: [0.16, 0.05, -0.4],
      rightShoulder: [-0.16, 0.05, -0.4],
      leftEye: [0.03, -0.12, -0.5],
      rightEye: [-0.03, -0.12, -0.5],
    };
    const frame = measureSquatForm(poseFrom(leaning))!;
    expect(frame.view).toBe('front');
    expect(frame.eyeTilt).toEqual({ deg: 0, toward: 'right' });
    expect(frame.trunkSideLean).toBeDefined();
  });

  it('flags both knees caving inside the heel line', () => {
    const frame = measureSquatForm(poseFrom(KNEES_CAVING))!;
    expect(frame.faults).toEqual(expect.arrayContaining(['left_knee_inward', 'right_knee_inward']));
  });

  it('does not check the knee line while standing', () => {
    // Heel well out to the side: the knee is off its line, but the legs are straight.
    const frame = measureSquatForm(poseFrom({ ...FRONT_STANDING, leftHeel: [0.32, 0.95, 0.05] }))!;
    expect(frame.kneeLines.find((line) => line.side === 'left')!.offsetRatio).toBeGreaterThan(0.25);
    expect(frame.engaged).toBe(false);
    expect(frame.faults).toEqual([]);
  });

  it('flags uneven shoulders and reports which side drops', () => {
    const frame = measureSquatForm(poseFrom({ ...FRONT_SQUAT, leftShoulder: [0.2, -0.09, 0.1] }))!;
    expect(frame.shoulderTilt?.toward).toBe('left');
    expect(frame.shoulderTilt!.deg).toBeGreaterThan(6);
    expect(frame.faults).toContain('shoulders_uneven');
  });

  it('flags a sideways trunk lean', () => {
    const frame = measureSquatForm(
      poseFrom({ ...FRONT_SQUAT, leftShoulder: [0.32, -0.15, 0.1], rightShoulder: [-0.08, -0.15, 0.1] }),
    )!;
    expect(frame.trunkSideLean?.toward).toBe('left');
    expect(frame.faults).toContain('trunk_leaning_sideways');
  });

  it('reads a side-view squat and flags knees past the toes', () => {
    const good = measureSquatForm(poseFrom(sideBody()))!;
    expect(good.view).toBe('side');
    expect(good.kneeLines).toHaveLength(1);
    expect(good.faults).toEqual([]);

    const past = measureSquatForm(poseFrom(sideBody({ knee: [0.32, 0.5] })))!;
    expect(past.faults).toContain('knee_past_toes');
  });

  it('reads a straight leg, an upright back and a vertical shin all as 0°', () => {
    const frame = measureSquatForm(
      poseFrom(sideBody({ shoulder: [0, -0.6], hip: [0, -0.1], knee: [0, 0.4] })),
    )!;
    expect(frame.kneeAngle.left).toBe(0);
    expect(frame.backAngle.left).toBe(0);
    expect(frame.ankleAngle.left).toBe(0);
    expect(frame.engaged).toBe(false);
  });

  it('measures side-view angles: back and shin from vertical, knee as femur-to-tibia flexion', () => {
    // Trunk leans 27° forward of vertical, shin 23° from vertical, thigh 84° from vertical:
    // femur-to-tibia flexion is 84 + 23 = 107°.
    const rad = Math.PI / 180;
    const ankle: [number, number] = [0, 0.9];
    const knee: [number, number] = [ankle[0] + 0.45 * Math.sin(23 * rad), ankle[1] - 0.45 * Math.cos(23 * rad)];
    const hip: [number, number] = [knee[0] - 0.45 * Math.sin(84 * rad), knee[1] - 0.45 * Math.cos(84 * rad)];
    const shoulder: [number, number] = [hip[0] + 0.5 * Math.sin(27 * rad), hip[1] - 0.5 * Math.cos(27 * rad)];
    const frame = measureSquatForm(poseFrom(sideBody({ shoulder, hip, knee })))!;
    expect(frame.view).toBe('side');
    expect(frame.backAngle.left).toBe(27);
    expect(frame.ankleAngle.left).toBe(23);
    expect(frame.kneeAngle.left).toBe(107);
    expect(frame.engaged).toBe(true);
  });

  it('reads the knee and back angles the same whichever way the patient faces', () => {
    const mirror = (body: Body): Body =>
      Object.fromEntries(Object.entries(body).map(([name, [x, y, z]]) => [name, [-x, y, z]])) as Body;
    const right = measureSquatForm(poseFrom(sideBody()))!;
    const left = measureSquatForm(poseFrom(mirror(sideBody())))!;
    expect(left.kneeAngle.left).toBe(right.kneeAngle.left);
    expect(left.backAngle.left).toBe(right.backAngle.left);
    expect(left.ankleAngle.left).toBe(right.ankleAngle.left);
    expect(left.kneeHeelAngle.left).toBe(right.kneeHeelAngle.left);
    expect(left.faults).toEqual(right.faults);
  });

  it('side view measures in the camera image, so each number matches the line drawn over the video', () => {
    // World depth puts the knee well past the toes, but the camera sees it behind the toe line.
    const pose = poseFrom(sideBody());
    pose.worldLandmarks = pose.worldLandmarks!.map((lm, i) =>
      i === POSE_LANDMARK_INDEX.leftKnee || i === POSE_LANDMARK_INDEX.rightKnee ? { ...lm, x: lm.x + 0.4 } : lm,
    );
    const frame = measureSquatForm(pose)!;
    expect(frame.faults).not.toContain('knee_past_toes');
    expect(frame.kneeAngle.left).toBe(measureSquatForm(poseFrom(sideBody()))!.kneeAngle.left);
  });

  it('flags the chest dropping in a side view', () => {
    const frame = measureSquatForm(poseFrom(sideBody({ shoulder: [0.3, 0] })))!;
    expect(frame.faults).toContain('chest_dropping');
  });

  it('keeps the trunk parallel to the shin as good form', () => {
    // Shin 23° from vertical, trunk 40° from vertical: 17° apart, inside the 25° allowance.
    const rad = Math.PI / 180;
    const hip: [number, number] = [-0.25, 0.35];
    const shoulder: [number, number] = [hip[0] + 0.5 * Math.sin(40 * rad), hip[1] - 0.5 * Math.cos(40 * rad)];
    const knee: [number, number] = [0.45 * Math.sin(23 * rad), 0.9 - 0.45 * Math.cos(23 * rad)];
    const frame = measureSquatForm(poseFrom(sideBody({ shoulder, hip, knee })))!;
    expect(frame.backAngle.left).toBe(40);
    expect(frame.faults).not.toContain('chest_dropping');
  });

  it('starts the knee-line checks once the knee bends past 25° of flexion', () => {
    // Straight shin: the thigh angle alone sets the flexion.
    const rad = Math.PI / 180;
    const bentBy = (deg: number) => {
      const hip: [number, number] = [-0.45 * Math.sin(deg * rad), 0.45 - 0.45 * Math.cos(deg * rad)];
      return sideBody({ shoulder: [hip[0], hip[1] - 0.5], hip, knee: [0, 0.45] });
    };
    expect(measureSquatForm(poseFrom(bentBy(24)))!.engaged).toBe(false);
    expect(measureSquatForm(poseFrom(bentBy(26)))!.engaged).toBe(true);
  });
});

describe('knee against the vertical line from the heel', () => {
  it('measures the angle at the heel, between the vertical line and the knee', () => {
    // Heel at (-0.05, 0.95); knee straight above it, then 0.2 forward over a 0.55 rise.
    const onLine = measureSquatForm(poseFrom(sideBody({ knee: [-0.05, 0.4] })))!;
    expect(onLine.kneeHeelAngle.left).toBe(0);
    const forward = measureSquatForm(poseFrom(sideBody({ knee: [0.15, 0.4] })))!;
    expect(forward.kneeHeelAngle.left).toBeCloseTo((Math.atan2(0.2, 0.55) * 180) / Math.PI, 0);
  });

  it('reads both knees in front view, and how far each is off its own heel', () => {
    const frame = measureSquatForm(poseFrom({ ...FRONT_SQUAT, leftKnee: [0.05, 0.5, -0.15] }))!;
    expect(frame.kneeHeelAngle.left).toBeCloseTo((Math.atan2(0.08, 0.45) * 180) / Math.PI, 0);
    expect(frame.kneeHeelAngle.right).toBeCloseTo((Math.atan2(0.01, 0.45) * 180) / Math.PI, 0);
  });

  it('draws the reference from the heel: each knee line carries its heel point', () => {
    const frame = measureSquatForm(poseFrom(FRONT_SQUAT))!;
    const left = frame.kneeLines.find((line) => line.side === 'left')!;
    expect(left.heel!.x).toBeCloseTo(0.13 / 2 + 0.5, 6);
    expect(left.heel!.y).toBeCloseTo(0.95 / 2 + 0.5, 6);
  });

  it('front view judges the knee against the heel line, not the toe', () => {
    // Toes turned far out: the knee is far from the toe but right above the heel.
    const toesOut = measureSquatForm(
      poseFrom({ ...FRONT_SQUAT, leftFootIndex: [0.4, 0.95, -0.12], rightFootIndex: [-0.4, 0.95, -0.12] }),
    )!;
    expect(toesOut.faults).toEqual([]);

    // Toes under the caved knee: the toe line would pass it, the heel line must not.
    const caved = measureSquatForm(
      poseFrom({ ...KNEES_CAVING, leftFootIndex: [0.02, 0.95, -0.12], rightFootIndex: [-0.02, 0.95, -0.12] }),
    )!;
    expect(caved.faults).toEqual(expect.arrayContaining(['left_knee_inward', 'right_knee_inward']));
  });

  it('front view flags a knee pushed out past its heel line', () => {
    const frame = measureSquatForm(poseFrom({ ...FRONT_SQUAT, leftKnee: [0.26, 0.5, -0.15] }))!;
    expect(frame.faults).toContain('left_knee_outward');
  });

  it('side view still judges "knee past toes" from the toes, not the heel line', () => {
    // Knee far ahead of the heel but behind the toes: a normal squat.
    const frame = measureSquatForm(poseFrom(sideBody({ knee: [0.14, 0.5] })))!;
    expect(frame.kneeHeelAngle.left).toBeGreaterThan(15);
    expect(frame.faults).not.toContain('knee_past_toes');
  });

  it('keeps the side-view knee check when the heel is hidden, without a heel reading', () => {
    const pose = poseFrom(sideBody({ knee: [0.32, 0.5] }));
    pose.landmarks[POSE_LANDMARK_INDEX.leftHeel]!.visibility = 0;
    pose.landmarks[POSE_LANDMARK_INDEX.rightHeel]!.visibility = 0;
    const frame = measureSquatForm(pose)!;
    expect(frame.kneeHeelAngle.left).toBeUndefined();
    expect(frame.kneeLines[0]!.heel).toBeNull();
    expect(frame.faults).toContain('knee_past_toes');
  });

  it('draws a heel line in side view when the toe is hidden, with no toe check', () => {
    const pose = poseFrom(sideBody({ knee: [0.32, 0.5] }));
    pose.landmarks[POSE_LANDMARK_INDEX.leftFootIndex]!.visibility = 0;
    pose.landmarks[POSE_LANDMARK_INDEX.rightFootIndex]!.visibility = 0;
    const frame = measureSquatForm(pose)!;
    expect(frame.kneeLines[0]!.heel).not.toBeNull();
    expect(frame.kneeLines[0]!.offsetRatio).toBeNull();
    expect(frame.faults).not.toContain('knee_past_toes');
  });

  it('makes no heel judgement in front view when the heel is hidden', () => {
    const pose = poseFrom(KNEES_CAVING);
    pose.landmarks[POSE_LANDMARK_INDEX.leftHeel]!.visibility = 0;
    const frame = measureSquatForm(pose)!;
    expect(frame.kneeHeelAngle.left).toBeUndefined();
    expect(frame.kneeLines.some((line) => line.side === 'left')).toBe(false);
    expect(frame.faults).not.toContain('left_knee_inward');
    expect(frame.faults).toContain('right_knee_inward');
  });

  it('never reads a NaN when the knee sits exactly on the heel', () => {
    const frame = measureSquatForm(poseFrom(sideBody({ knee: [-0.05, 0.95] })))!;
    expect(Number.isFinite(frame.kneeHeelAngle.left)).toBe(true);
  });
});

describe('squat reference axis', () => {
  it('stays exactly screen-vertical while the feet landmarks jitter', () => {
    const monitor = new SquatFormMonitor();
    for (const [i, lift] of [0, 0.04, -0.03, 0.05, -0.05, 0.02].entries()) {
      const pose = poseFrom({ ...FRONT_SQUAT, leftHeel: [0.13, 0.95 + lift, 0.05], rightFootIndex: [-0.15, 0.95 - lift, -0.12] });
      expect(monitor.update(pose, i * 33, 0).frame!.upImage).toEqual({ x: 0, y: -1 });
    }
  });

  it('measures tilts against the screen horizontal, not the feet', () => {
    // Left foot stepped lower in the image: the old feet line would tilt the reference.
    const frame = measureSquatForm(
      poseFrom({ ...FRONT_SQUAT, leftAnkle: [0.13, 1.0, 0], leftHeel: [0.13, 1.05, 0.05], leftFootIndex: [0.15, 1.05, -0.12] }),
    )!;
    expect(frame.shoulderTilt).toEqual({ deg: 0, toward: 'right' });
    expect(frame.pelvisTilt!.deg).toBe(0);
  });
});

describe('SquatFormMonitor', () => {
  it('only sustains a fault after one second', () => {
    const monitor = new SquatFormMonitor();
    expect(monitor.update(poseFrom(KNEES_CAVING), 0, 0).faults[0]).toMatchObject({ sustained: false });
    expect(monitor.update(poseFrom(KNEES_CAVING), 900, 0).faults[0]).toMatchObject({ sustained: false });
    const result = monitor.update(poseFrom(KNEES_CAVING), 1000, 0);
    expect(result.faults[0]).toMatchObject({ code: 'left_knee_inward', sustained: true });
  });

  it('keeps the onset through a single dropped frame but restarts after a real correction', () => {
    const monitor = new SquatFormMonitor();
    monitor.update(poseFrom(KNEES_CAVING), 0, 0);
    monitor.update(poseFrom(FRONT_SQUAT), 100, 0);
    expect(monitor.update(poseFrom(KNEES_CAVING), 200, 0).faults[0]?.since).toBe(0);

    monitor.update(poseFrom(FRONT_SQUAT), 300, 0);
    monitor.update(poseFrom(FRONT_SQUAT), 600, 0);
    expect(monitor.update(poseFrom(KNEES_CAVING), 700, 0).faults[0]).toMatchObject({ since: 700, sustained: false });
  });

  it('scores reps as correct or incorrect by sustained faults during the rep', () => {
    const monitor = new SquatFormMonitor();
    monitor.update(poseFrom(FRONT_SQUAT), 0, 0);
    let result = monitor.update(poseFrom(FRONT_STANDING), 500, 1);
    expect(result).toMatchObject({ correctReps: 1, incorrectReps: 0 });

    monitor.update(poseFrom(KNEES_CAVING), 1000, 1);
    monitor.update(poseFrom(KNEES_CAVING), 2100, 1);
    result = monitor.update(poseFrom(FRONT_STANDING), 2500, 2);
    expect(result).toMatchObject({ correctReps: 1, incorrectReps: 1 });

    result = monitor.update(poseFrom(FRONT_STANDING), 3500, 0);
    expect(result).toMatchObject({ correctReps: 0, incorrectReps: 0 });
  });
});
