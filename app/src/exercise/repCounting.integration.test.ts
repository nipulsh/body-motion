/**
 * Integration: pose landmarks → JointAngleCalculator → RepDetector with the configured
 * rep angle ranges, using the real exercise library and plan-exercise normalisation.
 */
import { describe, expect, it } from 'vitest';
import { ExerciseFormMonitor, type Exercise, type PoseLandmark, type PoseResult } from '@vision';
import { MotionTracker } from '../../../vision/motion/MotionTracker';
import { EXERCISE_LIBRARY } from './library';
import { normalizeExercise } from './normalizeExercise';

const deg = Math.PI / 180;

function blank(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
}

const I = {
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32,
} as const;

/** Metric world pose (MediaPipe world space, y down) with both knees at `kneeDeg` and elbows at `elbowDeg`. */
function worldPose(kneeDeg: number, elbowDeg = 175): PoseLandmark[] {
  const w = blank();
  const put = (i: number, x: number, y: number, z: number) => (w[i] = { x, y, z, visibility: 0.95 });
  const half = (180 - kneeDeg) / 2;
  for (const [side, x] of [['left', 0.1], ['right', -0.1]] as const) {
    const hip = { x, y: 0, z: 0 };
    const knee = { x, y: 0.42 * Math.cos(half * deg), z: -0.42 * Math.sin(half * deg) };
    const ankle = { x, y: knee.y + 0.4 * Math.cos(half * deg), z: knee.z + 0.4 * Math.sin(half * deg) };
    put(I[`${side}Hip`], hip.x, hip.y, hip.z);
    put(I[`${side}Knee`], knee.x, knee.y, knee.z);
    put(I[`${side}Ankle`], ankle.x, ankle.y, ankle.z);
    put(I[`${side}Heel`], x, ankle.y + 0.05, ankle.z + 0.05);
    put(I[`${side}FootIndex`], x, ankle.y + 0.05, ankle.z - 0.15);
    const shoulder = { x: x * 2, y: -0.5, z: 0 };
    put(I[`${side}Shoulder`], shoulder.x, shoulder.y, shoulder.z);
    const elbow = { x: shoulder.x, y: -0.2, z: 0 };
    put(I[`${side}Elbow`], elbow.x, elbow.y, elbow.z);
    const bend = (180 - elbowDeg) * deg;
    put(I[`${side}Wrist`], elbow.x, elbow.y + 0.25 * Math.cos(bend), -0.25 * Math.sin(bend));
  }
  return w;
}

function pose(kneeDeg: number, timestamp: number, elbowDeg?: number): PoseResult {
  const world = worldPose(kneeDeg, elbowDeg);
  // Image landmarks only gate visibility here; geometry comes from the world landmarks.
  const image = world.map((lm) => ({ ...lm, x: 0.5 + lm.x / 2, y: 0.5 + lm.y / 2 }));
  return { landmarks: image, worldLandmarks: world, confidence: 0.95, timestamp, frameAspect: 16 / 9 };
}

function countReps(exercise: Exercise, kneeAngles: number[], elbowAngles?: number[]): number {
  const tracker = new MotionTracker();
  tracker.startExercise(exercise);
  let t = 0;
  kneeAngles.forEach((knee, i) => {
    t += 150;
    tracker.update(pose(knee, t, elbowAngles?.[i]));
  });
  return tracker.getLastRepResult()?.repCount ?? 0;
}

/** Smooth path between key angles in ≤10° steps, like real frames at 15 fps. */
function path(...keys: number[]): number[] {
  const out: number[] = [keys[0]!];
  for (let i = 1; i < keys.length; i++) {
    const from = keys[i - 1]!;
    const to = keys[i]!;
    const steps = Math.max(1, Math.ceil(Math.abs(to - from) / 10));
    for (let s = 1; s <= steps; s++) out.push(from + ((to - from) * s) / steps);
  }
  return out;
}

const squat = EXERCISE_LIBRARY.find((e) => e.id === 'library_squat')!;
const curl = EXERCISE_LIBRARY.find((e) => e.id === 'library_elbow_flexion')!;

describe('squat rep counting from poses (library exercise)', () => {
  it('counts three squats that reach 80–100°', () => {
    expect(countReps(squat, path(175, 90, 175, 92, 175, 85, 175))).toBe(3);
  });

  it('does not count half squats that stop at 115°', () => {
    expect(countReps(squat, path(175, 115, 175, 115, 175))).toBe(0);
  });

  it('counts a deep squat that passes through the window', () => {
    expect(countReps(squat, path(175, 65, 175))).toBe(1);
  });

  it('does not count a squat that never returns to standing', () => {
    expect(countReps(squat, path(175, 90, 140, 90, 140))).toBe(0);
  });
});

describe('plan (Gemini) exercises pick up the configured ranges by name', () => {
  it('a generated "Wall Squat" with a loose rule still counts only at 80–100°', () => {
    const generated: Exercise = {
      ...squat,
      id: 'gemini-1',
      name: 'Wall Squat',
      trackingRules: squat.trackingRules.map((rule) => ({
        ...rule, targetRange: undefined, startRange: undefined, requiredAngle: 120, tolerance: 25,
      })),
    };
    const normalized = normalizeExercise(generated);
    expect(normalized.trackingRules[0]!.targetRange).toEqual({ min: 80, max: 100 });
    expect(countReps(normalized, path(175, 115, 175))).toBe(0);
    expect(countReps(normalized, path(175, 90, 175))).toBe(1);
  });
});

describe('elbow flexion rep counting from poses', () => {
  it('counts curls into the 40–85° window', () => {
    const elbows = path(175, 60, 175, 60, 175);
    expect(countReps(curl, elbows.map(() => 175), elbows)).toBe(2);
  });
});

function tiltsDuringRoll(rolls: number[]): { tilts: number[]; ups: Array<{ x: number; y: number }> } {
  const monitor = new ExerciseFormMonitor();
  monitor.start(squat);
  const frontPose = (rollDeg: number, t: number): PoseResult => {
    const lm = blank().map((p) => ({ ...p, visibility: 0 }));
    const set = (i: number, x: number, y: number) => {
      const r = rollDeg * deg;
      const dx = x - 0.5;
      const dy = y - 0.5;
      lm[i] = { x: 0.5 + dx * Math.cos(r) - dy * Math.sin(r), y: 0.5 + dx * Math.sin(r) + dy * Math.cos(r), z: 0, visibility: 0.95 };
    };
    set(I.leftShoulder, 0.62, 0.31); set(I.rightShoulder, 0.38, 0.29);
    set(I.leftHip, 0.56, 0.56); set(I.rightHip, 0.44, 0.56);
    set(I.leftKnee, 0.56, 0.74); set(I.rightKnee, 0.44, 0.74);
    set(I.leftAnkle, 0.56, 0.92); set(I.rightAnkle, 0.44, 0.92);
    set(I.leftHeel, 0.56, 0.94); set(I.rightHeel, 0.44, 0.94);
    set(I.leftFootIndex, 0.57, 0.95); set(I.rightFootIndex, 0.43, 0.95);
    return { landmarks: lm, confidence: 0.9, timestamp: t, frameAspect: 1 };
  };
  const tilts: number[] = [];
  const ups: Array<{ x: number; y: number }> = [];
  let t = 0;
  for (const roll of rolls) {
    t += 100;
    const result = monitor.update(frontPose(roll, t), t, 0, 1);
    const frame = result?.frame as { shoulderTilt?: { deg: number }; upImage?: { x: number; y: number } } | null | undefined;
    if (frame?.shoulderTilt) tilts.push(frame.shoulderTilt.deg);
    if (frame?.upImage) ups.push(frame.upImage);
  }
  return { tilts, ups };
}

describe('squat form during a session with a camera that rolls mid-set', () => {
  const rolls = [0, 0, 0, 5, 10, 15, 20, 20, 20, 20, 20, 20];

  // References are locked to the screen edges (product decision): a rolled camera is not
  // corrected, and the reference lines never wobble or turn for a roll short of horizontal.
  it('keeps the reference exactly square to the screen through the whole roll', () => {
    const { ups } = tiltsDuringRoll(rolls);
    expect(ups).toHaveLength(rolls.length);
    for (const up of ups) expect(up).toEqual({ x: 0, y: -1 });
  });

  it('reads the shoulder tilt the camera sees: the roll adds to it, and it holds once the roll stops', () => {
    const { tilts } = tiltsDuringRoll(rolls);
    expect(tilts.length).toBeGreaterThan(8);
    // True tilt ~4.8°; a 20° roll the other way of the low shoulder adds 20°.
    expect(tilts[tilts.length - 1]! - tilts[0]!).toBeCloseTo(20, 0);
    expect(tilts[tilts.length - 1]).toBe(tilts[tilts.length - 2]);
  });
});
