import { describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../types';
import { measureSquatForm, SquatFormMonitor } from './squatForm';

type Body = Partial<Record<PoseLandmarkName, [number, number, number]>>;

/** World-space pose (metres, y down) and a square camera image of it at half scale. */
function poseFrom(body: Body): PoseResult {
  const world: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y, z]] of Object.entries(body) as [PoseLandmarkName, [number, number, number]][]) {
    world[POSE_LANDMARK_INDEX[name]] = { x, y, z, visibility: 0.99 };
  }
  const landmarks = world.map((lm) => ({ ...lm, x: lm.x / 2 + 0.5, y: lm.y / 2 + 0.5 }));
  return { landmarks, worldLandmarks: world, confidence: 0.99, timestamp: 0, frameAspect: 1 };
}

type SidePoints = Partial<Record<'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe', [number, number]>>;

/** Facing image-right, seen side-on. */
function side(overrides: SidePoints = {}): Body {
  const p = {
    shoulder: [0.03, -0.6],
    hip: [0, -0.1],
    knee: [0.02, 0.4],
    ankle: [0, 0.9],
    heel: [-0.05, 0.95],
    toe: [0.15, 0.95],
    ...overrides,
  } as Record<keyof SidePoints, [number, number]>;
  const body: Body = {};
  for (const [s, z] of [['left', 0.1], ['right', -0.1]] as const) {
    body[`${s}Shoulder`] = [...p.shoulder, z * 2];
    body[`${s}Hip`] = [...p.hip, z];
    body[`${s}Knee`] = [...p.knee, z];
    body[`${s}Ankle`] = [...p.ankle, z];
    body[`${s}Heel`] = [...p.heel, z];
    body[`${s}FootIndex`] = [...p.toe, z];
  }
  return body;
}

const SQUAT_BOTTOM = side({ shoulder: [-0.05, -0.15], hip: [-0.25, 0.35], knee: [0.2, 0.5] });

const FRONT: Body = {
  leftEye: [0.03, -0.75, 0],
  rightEye: [-0.03, -0.75, 0],
  leftShoulder: [0.2, -0.5, 0],
  rightShoulder: [-0.2, -0.47, 0],
  leftHip: [0.12, 0, 0],
  rightHip: [-0.12, 0, 0],
  leftKnee: [0.15, 0.45, 0],
  rightKnee: [-0.15, 0.45, 0],
  leftAnkle: [0.13, 0.9, 0],
  rightAnkle: [-0.13, 0.9, 0],
  leftHeel: [0.13, 0.95, 0],
  rightHeel: [-0.13, 0.95, 0],
  leftFootIndex: [0.16, 0.95, -0.1],
  rightFootIndex: [-0.16, 0.95, -0.1],
};

const FRONT_KNEES_CAVING: Body = {
  ...FRONT,
  leftShoulder: [0.2, -0.15, 0.1],
  rightShoulder: [-0.2, -0.12, 0.1],
  leftHip: [0.12, 0.35, 0.3],
  rightHip: [-0.12, 0.35, 0.3],
  leftKnee: [0.02, 0.5, -0.15],
  rightKnee: [-0.02, 0.5, -0.15],
};

const HOLD_MS = 1000;
const STEP_MS = 33;

/** Feed `body` for `ms`, returning the last result and the time to continue from. */
function hold(monitor: SquatFormMonitor, body: Body | ((t: number) => Body), from = 0, ms = HOLD_MS + 100) {
  let result = monitor.update(poseFrom(typeof body === 'function' ? body(from) : body), from, 0);
  let t = from;
  while (t < from + ms) {
    t += STEP_MS;
    result = monitor.update(poseFrom(typeof body === 'function' ? body(t) : body), t, 0);
  }
  return { result, frame: result.frame!, t };
}

describe('standing zero', () => {
  it('shows true geometry, marked unset, until the patient has stood still', () => {
    const raw = measureSquatForm(poseFrom(side()))!;
    expect(raw.kneeHeelAngle.left).toBeGreaterThan(5);
    expect(raw.kneeAngle.left).toBeGreaterThan(2);
    expect(raw.backAngle.left).toBeGreaterThan(2);

    const monitor = new SquatFormMonitor();
    const first = monitor.update(poseFrom(side()), 0, 0).frame!;
    expect(first.zeroSet).toBe(false);
    expect(first.kneeHeelAngle.left).toBe(raw.kneeHeelAngle.left);
    expect(first.kneeAngle.left).toBe(raw.kneeAngle.left);
    expect(first.backAngle.left).toBe(raw.backAngle.left);
  });

  it('does not set the zero one frame early', () => {
    const { frame } = hold(new SquatFormMonitor(), side(), 0, HOLD_MS - STEP_MS);
    expect(frame.zeroSet).toBe(false);
  });

  it('reads every side-view angle as 0° after standing still', () => {
    const { frame } = hold(new SquatFormMonitor(), side());
    expect(frame.zeroSet).toBe(true);
    expect(frame.kneeAngle.left).toBe(0);
    expect(frame.backAngle.left).toBe(0);
    expect(frame.kneeHeelAngle.left).toBe(0);
  });

  it('reads every front-view angle and tilt as 0° after standing still', () => {
    const { frame } = hold(new SquatFormMonitor(), FRONT);
    expect(frame.view).toBe('front');
    expect(frame.zeroSet).toBe(true);
    expect(frame.kneeAngle).toEqual({ left: 0, right: 0 });
    expect(frame.kneeHeelAngle).toEqual({ left: 0, right: 0 });
    expect(frame.shoulderTilt!.deg).toBe(0);
    expect(frame.pelvisTilt!.deg).toBe(0);
    expect(frame.eyeTilt!.deg).toBe(0);
    expect(frame.trunkSideLean!.deg).toBe(0);
  });

  it('subtracts the standing pose from a squat', () => {
    const monitor = new SquatFormMonitor();
    const standing = measureSquatForm(poseFrom(side()))!;
    const { t } = hold(monitor, side());
    const raw = measureSquatForm(poseFrom(SQUAT_BOTTOM))!;
    const frame = monitor.update(poseFrom(SQUAT_BOTTOM), t + STEP_MS, 0).frame!;
    expect(frame.kneeAngle.left).toBeCloseTo(raw.kneeAngle.left! - standing.kneeAngle.left!, 0);
    expect(frame.kneeHeelAngle.left).toBeCloseTo(raw.kneeHeelAngle.left! - standing.kneeHeelAngle.left!, 0);
    expect(frame.backAngle.left).toBeCloseTo(raw.backAngle.left! - standing.backAngle.left!, 0);
  });

  it('counts a lean past upright the other way as the full movement', () => {
    const monitor = new SquatFormMonitor();
    // Stands 5.7° forward, then leans 5.7° back: 11.4° of movement, though both read 5.7° raw.
    const { t } = hold(monitor, side({ shoulder: [0.05, -0.6] }));
    const frame = monitor.update(poseFrom(side({ shoulder: [-0.05, -0.6] })), t + STEP_MS, 0).frame!;
    expect(frame.backAngle.left).toBeCloseTo(11.4, 0);
  });

  it('never reads a knee as bent past zero when it straightens beyond the standing pose', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, side());
    const frame = monitor.update(poseFrom(side({ knee: [0, 0.4] })), t + STEP_MS, 0).frame!;
    expect(frame.kneeAngle.left).toBe(0);
  });

  it('reads 0° through ordinary landmark jitter while standing', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, side());
    for (const [i, jitter] of [0.008, -0.008, 0.005, -0.004].entries()) {
      const shaken = side({ knee: [0.02 + jitter, 0.4], shoulder: [0.03 + jitter, -0.6] });
      const frame = monitor.update(poseFrom(shaken), t + (i + 1) * STEP_MS, 0).frame!;
      expect(frame.kneeAngle.left).toBe(0);
      expect(frame.backAngle.left).toBe(0);
      expect(frame.kneeHeelAngle.left).toBe(0);
    }
  });

  it('keeps the side a tilt leans toward when measuring from the zero', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, FRONT);
    // Shoulders swing the other way: the right side drops well past the standing pose.
    const frame = monitor.update(poseFrom({ ...FRONT, rightShoulder: [-0.2, -0.4, 0] }), t + STEP_MS, 0).frame!;
    const raw = measureSquatForm(poseFrom({ ...FRONT, rightShoulder: [-0.2, -0.4, 0] }))!;
    expect(raw.shoulderTilt!.toward).toBe('right');
    expect(frame.shoulderTilt!.toward).toBe('right');
    expect(frame.shoulderTilt!.deg).toBeLessThan(raw.shoulderTilt!.deg);
    expect(frame.shoulderTilt!.deg).toBeGreaterThan(5);
  });
});

describe('when the zero is captured', () => {
  it('ignores a pose held at the bottom of the squat', () => {
    const { frame } = hold(new SquatFormMonitor(), SQUAT_BOTTOM, 0, 3000);
    expect(frame.zeroSet).toBe(false);
    expect(frame.kneeAngle.left).toBeGreaterThan(90);
  });

  it('ignores a pose with the back well forward, even with straight legs', () => {
    const bentOver = side({ shoulder: [0.4, -0.4] });
    expect(hold(new SquatFormMonitor(), bentOver, 0, 3000).frame.zeroSet).toBe(false);
  });

  it('ignores someone moving through a standing pose', () => {
    // Knee rocking ±8 cm a second: never still, though always inside the standing limits.
    const rocking = (t: number) => side({ knee: [0.02 + 0.08 * Math.sin((t / 1000) * 2 * Math.PI), 0.4] });
    expect(hold(new SquatFormMonitor(), rocking, 0, 3000).frame.zeroSet).toBe(false);
  });

  it('is not thrown off by a single bad frame', () => {
    const monitor = new SquatFormMonitor();
    const spiky = (t: number) => (t === 495 ? side({ knee: [0.15, 0.4] }) : side());
    const { frame } = hold(monitor, spiky);
    expect(frame.zeroSet).toBe(true);
    expect(frame.kneeHeelAngle.left).toBe(0);
  });

  it('starts the hold again after the patient drops out of view', () => {
    const monitor = new SquatFormMonitor();
    monitor.update(poseFrom(side()), 0, 0);
    monitor.update(poseFrom(side()), 400, 0);
    monitor.update(null, 500, 0);
    expect(monitor.update(poseFrom(side()), 1500, 0).frame!.zeroSet).toBe(false);
    expect(hold(monitor, side(), 1500).frame.zeroSet).toBe(true);
  });

  it('moves the zero when the patient later stands straighter than where it was set', () => {
    const monitor = new SquatFormMonitor();
    // Starts in a shallow knee bend and holds it, then stands up.
    const shallow = side({ hip: [-0.12, -0.05], shoulder: [-0.09, -0.55], knee: [0.08, 0.42] });
    const set = hold(monitor, shallow);
    expect(set.frame.zeroSet).toBe(true);
    expect(set.frame.kneeAngle.left).toBe(0);

    const before = monitor.update(poseFrom(side()), set.t + STEP_MS, 0).frame!;
    expect(before.kneeAngle.left).toBe(0);
    const { frame, t } = hold(monitor, side(), set.t + 2 * STEP_MS);
    expect(frame.kneeAngle.left).toBe(0);

    // The shallow bend now reads as a real bend instead of zero.
    const again = monitor.update(poseFrom(shallow), t + STEP_MS, 0).frame!;
    expect(again.kneeAngle.left).toBeGreaterThan(10);
  });

  it('never moves the zero to a more bent pose', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, side());
    const shallow = side({ hip: [-0.12, -0.05], shoulder: [-0.09, -0.55], knee: [0.08, 0.42] });
    const { frame } = hold(monitor, shallow, t + STEP_MS, 3000);
    expect(frame.kneeAngle.left).toBeGreaterThan(10);
  });

  it('keeps a separate zero per view: turning to the side asks again', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, FRONT);
    const turned = monitor.update(poseFrom(side()), t + STEP_MS, 0).frame!;
    expect(turned.view).toBe('side');
    expect(turned.zeroSet).toBe(false);
    const sideSet = hold(monitor, side(), t + STEP_MS);
    expect(sideSet.frame.zeroSet).toBe(true);
    const back = monitor.update(poseFrom(FRONT), sideSet.t + STEP_MS, 0).frame!;
    expect(back.view).toBe('front');
    expect(back.zeroSet).toBe(true);
  });

  it('fills in a reading that was hidden when the zero was set', () => {
    const monitor = new SquatFormMonitor();
    const noHeel = () => {
      const pose = poseFrom(side());
      pose.landmarks[POSE_LANDMARK_INDEX.leftHeel]!.visibility = 0;
      pose.landmarks[POSE_LANDMARK_INDEX.rightHeel]!.visibility = 0;
      return pose;
    };
    let t = 0;
    for (; t <= HOLD_MS + 100; t += STEP_MS) monitor.update(noHeel(), t, 0);
    const heelBack = monitor.update(poseFrom(side()), t, 0).frame!;
    expect(heelBack.zeroSet).toBe(true);
    expect(heelBack.kneeHeelAngle.left).toBeGreaterThan(5);
    expect(hold(monitor, side(), t + STEP_MS).frame.kneeHeelAngle.left).toBe(0);
  });

  it('forgets the zero when the reference axis turns, as lying down turns it', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, side());
    const lying = side({ shoulder: [0.6, 0.1], hip: [0.1, 0.1], knee: [-0.3, 0.1], ankle: [-0.7, 0.1], heel: [-0.74, 0.14], toe: [-0.74, -0.05] });
    let frame = monitor.update(poseFrom(lying), t + STEP_MS, 0).frame!;
    for (let i = 2; i <= 6; i += 1) frame = monitor.update(poseFrom(lying), t + i * STEP_MS, 0).frame!;
    expect(frame.upImage).toEqual({ x: 1, y: 0 });
    expect(frame.zeroSet).toBe(false);
  });

  it('forgets the zero on reset', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, side());
    monitor.reset();
    expect(monitor.update(poseFrom(side()), t + STEP_MS, 0).frame!.zeroSet).toBe(false);
  });

  it('copes with time running backwards without keeping a bad hold', () => {
    const monitor = new SquatFormMonitor();
    monitor.update(poseFrom(side()), 5000, 0);
    expect(monitor.update(poseFrom(side()), 100, 0).frame!.zeroSet).toBe(false);
    expect(monitor.update(poseFrom(side()), 133, 0).frame!.zeroSet).toBe(false);
  });
});

describe('standing zero and coaching', () => {
  it('leaves fault decisions on true geometry: zeroing only changes the numbers shown', () => {
    const plain = measureSquatForm(poseFrom(FRONT_KNEES_CAVING))!;
    expect(plain.faults).toEqual(expect.arrayContaining(['left_knee_inward', 'right_knee_inward']));
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, FRONT);
    const zeroed = monitor.update(poseFrom(FRONT_KNEES_CAVING), t + STEP_MS, 0).frame!;
    expect(zeroed.zeroSet).toBe(true);
    expect(zeroed.faults).toEqual(plain.faults);
    expect(zeroed.engaged).toBe(plain.engaged);
  });

  it('does not change rep scoring', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, side());
    expect(monitor.update(poseFrom(SQUAT_BOTTOM), t + STEP_MS, 0)).toMatchObject({ correctReps: 0, incorrectReps: 0 });
    expect(monitor.update(poseFrom(side()), t + 2 * STEP_MS, 1)).toMatchObject({ correctReps: 1, incorrectReps: 0 });
  });

  it('startNewSet clears rep scores and fault timers but keeps the zero', () => {
    const monitor = new SquatFormMonitor();
    const { t } = hold(monitor, side());
    monitor.update(poseFrom(side()), t + STEP_MS, 1);
    monitor.startNewSet();
    const next = monitor.update(poseFrom(side()), t + 2 * STEP_MS, 0);
    expect(next).toMatchObject({ correctReps: 0, incorrectReps: 0 });
    expect(next.frame!.zeroSet).toBe(true);
    expect(next.frame!.kneeHeelAngle.left).toBe(0);
  });

  it('observeStanding sets the zero without running fault timers or scoring', () => {
    const monitor = new SquatFormMonitor();
    let t = 0;
    for (; t <= HOLD_MS + 100; t += STEP_MS) monitor.observeStanding(poseFrom(side()), t);
    const next = monitor.update(poseFrom(FRONT_KNEES_CAVING), t, 0);
    expect(next.faults.every((fault) => fault.since === t)).toBe(true);
    const frame = monitor.update(poseFrom(side()), t + STEP_MS, 0).frame!;
    expect(frame.zeroSet).toBe(true);
  });

  it('observeStanding ignores a missing pose', () => {
    const monitor = new SquatFormMonitor();
    expect(() => monitor.observeStanding(null, 0)).not.toThrow();
    expect(monitor.update(poseFrom(side()), 33, 0).frame!.zeroSet).toBe(false);
  });
});
