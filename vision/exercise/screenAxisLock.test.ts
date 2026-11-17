import { describe, expect, it } from 'vitest';
import { blankLandmarks, poseFromLandmarks, setLandmark } from '../test/fixtures';
import type { PoseLandmark } from '../types';
import {
  bodyLengthAxis,
  kneeFlexionDeg,
  kneeIncludedDeg,
  LandmarkSpace,
  nearestScreenAxis,
  ScreenAxisLock,
  signedFromVerticalDeg,
  type BodyAxis,
} from './formCommon';

const UP: BodyAxis = { x: 0, y: -1 };
const RIGHT: BodyAxis = { x: 1, y: 0 };
const LEFT: BodyAxis = { x: -1, y: 0 };

/** Unit axis `deg` clockwise on screen from screen up. */
function rotatedUp(deg: number): BodyAxis {
  const t = (deg * Math.PI) / 180;
  return { x: Math.sin(t), y: -Math.cos(t) };
}

function feed(lock: ScreenAxisLock, deg: number, frames: number): BodyAxis {
  let axis = lock.current();
  for (let i = 0; i < frames; i += 1) axis = lock.update(rotatedUp(deg));
  return axis;
}

describe('nearestScreenAxis', () => {
  it('snaps any direction to the closest screen edge direction', () => {
    expect(nearestScreenAxis(rotatedUp(10))).toEqual(UP);
    expect(nearestScreenAxis(rotatedUp(-40))).toEqual(UP);
    expect(nearestScreenAxis(rotatedUp(80))).toEqual(RIGHT);
    expect(nearestScreenAxis(rotatedUp(-100))).toEqual(LEFT);
    expect(nearestScreenAxis(rotatedUp(175))).toEqual({ x: 0, y: 1 });
  });
});

describe('ScreenAxisLock', () => {
  it('starts on screen up and only ever reports exact screen-edge directions', () => {
    const lock = new ScreenAxisLock();
    expect(lock.current()).toEqual(UP);
    for (const deg of [3, -7, 12, 25, -30, 44, 59]) {
      expect(lock.update(rotatedUp(deg))).toEqual(UP);
    }
  });

  it('does not move for landmark jitter or a deep hinge short of horizontal', () => {
    const lock = new ScreenAxisLock();
    expect(feed(lock, 55, 50)).toEqual(UP);
  });

  it('turns to horizontal once the wireframe has tipped past 60° for several frames', () => {
    const lock = new ScreenAxisLock();
    expect(feed(lock, 85, 4)).toEqual(UP);
    expect(feed(lock, 85, 1)).toEqual(RIGHT);
  });

  it('ignores a single glitched frame', () => {
    const lock = new ScreenAxisLock();
    feed(lock, 0, 3);
    expect(lock.update(rotatedUp(90))).toEqual(UP);
    expect(feed(lock, 0, 1)).toEqual(UP);
    // The glitch count does not carry over: four more tipped frames are still not enough.
    expect(feed(lock, 90, 4)).toEqual(UP);
  });

  it('has hysteresis: lying down it stays horizontal until the body is back within 30° of upright', () => {
    const lock = new ScreenAxisLock();
    feed(lock, -90, 5);
    expect(lock.current()).toEqual(LEFT);
    expect(feed(lock, -35, 20)).toEqual(LEFT);
    expect(feed(lock, -25, 5)).toEqual(UP);
  });

  it('holds the current axis when there is no candidate, and reset returns to screen up', () => {
    const lock = new ScreenAxisLock();
    feed(lock, 90, 5);
    expect(lock.update(null)).toEqual(RIGHT);
    lock.reset();
    expect(lock.current()).toEqual(UP);
  });

  it('rejects non-finite candidates', () => {
    const lock = new ScreenAxisLock();
    for (let i = 0; i < 10; i += 1) lock.update({ x: Number.NaN, y: 1 });
    expect(lock.current()).toEqual(UP);
  });
});

function landmarks(points: Record<string, [number, number]>): PoseLandmark[] {
  const lm = blankLandmarks(0);
  for (const [name, [x, y]] of Object.entries(points)) setLandmark(lm, name as never, { x, y, z: 0, visibility: 0.95 });
  return lm;
}

const space = (lm: PoseLandmark[]) => new LandmarkSpace({ ...poseFromLandmarks(lm), frameAspect: 1 }, 1, 0.5);

describe('bodyLengthAxis', () => {
  it('points from the ankles to the shoulders', () => {
    const axis = bodyLengthAxis(
      space(landmarks({ leftShoulder: [0.6, 0.2], rightShoulder: [0.4, 0.2], leftAnkle: [0.6, 0.9], rightAnkle: [0.4, 0.9] })),
    )!;
    expect(axis.x).toBeCloseTo(0);
    expect(axis.y).toBeCloseTo(-1);
  });

  it('falls back to the knees when the feet are out of view', () => {
    const axis = bodyLengthAxis(space(landmarks({ leftShoulder: [0.2, 0.5], leftKnee: [0.8, 0.5] })))!;
    expect(axis.x).toBeCloseTo(-1);
  });

  it('never uses the trunk alone: a hinged back is not a body lying down', () => {
    expect(bodyLengthAxis(space(landmarks({ leftShoulder: [0.7, 0.4], leftHip: [0.4, 0.5] })))).toBeNull();
  });
});

describe('angle helpers', () => {
  it('knee included angle: 180° straight, 90° at a right angle', () => {
    const hip = { x: 0, y: 0, z: 0 };
    expect(kneeIncludedDeg(hip, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 })).toBeCloseTo(180);
    expect(kneeIncludedDeg(hip, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 })).toBeCloseTo(90);
    expect(kneeIncludedDeg(hip, hip, { x: 1, y: 1, z: 0 })).toBeNaN();
  });

  it('knee flexion: 0° straight, 90° at a right angle', () => {
    const hip = { x: 0, y: 0, z: 0 };
    expect(kneeFlexionDeg(hip, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 })).toBeCloseTo(0);
    expect(kneeFlexionDeg(hip, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 })).toBeCloseTo(90);
    expect(kneeFlexionDeg(hip, hip, { x: 1, y: 1, z: 0 })).toBeNaN();
  });

  it('signed lean from vertical: 0° along the axis, positive toward image-right, negative toward image-left', () => {
    const hip = { x: 0, y: 0, z: 0 };
    expect(signedFromVerticalDeg(hip, { x: 0, y: -1, z: 0 }, UP)).toBeCloseTo(0);
    expect(signedFromVerticalDeg(hip, { x: 1, y: -1, z: 0 }, UP)).toBeCloseTo(45);
    expect(signedFromVerticalDeg(hip, { x: -1, y: -1, z: 0 }, UP)).toBeCloseTo(-45);
    expect(signedFromVerticalDeg(hip, { x: 1, y: 0, z: 0 }, UP)).toBeCloseTo(90);
  });
});
