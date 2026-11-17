import { describe, expect, it } from 'vitest';
import { blankLandmarks, setLandmark } from '../test/fixtures';
import { getLandmark } from './landmarks';
import {
  buildDecoupledPoseLandmarks,
  CM_PER_IN,
  squatDepthExtraDropIn,
  SquatDepthTracker,
} from './wireframeDecoupled';

describe('squatDepthExtraDropIn', () => {
  it('moves the wireframe 15 cm when the hips drop 10 cm at gain 1.5', () => {
    const depthIn = 10 / CM_PER_IN;
    const dropIn = squatDepthExtraDropIn(depthIn, 1.5);
    expect(dropIn).toBeCloseTo(15 / CM_PER_IN, 6);
  });
});

describe('SquatDepthTracker', () => {
  it('tracks depth below the highest hip height seen', () => {
    const tracker = new SquatDepthTracker();
    const t0 = 0;
    expect(tracker.update({ x: 0, h: 38 }, t0)).toBe(0);
    expect(tracker.update({ x: 0, h: 34 }, t0 + 33)).toBeCloseTo(4, 6);
    expect(tracker.update({ x: 0, h: 38 }, t0 + 66)).toBe(0);
  });
});

describe('buildDecoupledPoseLandmarks', () => {
  it('keeps the torso on the reference and scales arm segments to 1.5× live length', () => {
    const reference = blankLandmarks(0.9);
    setLandmark(reference, 'leftShoulder', { x: 0.4, y: 0.3, visibility: 0.9 });
    setLandmark(reference, 'leftElbow', { x: 0.3, y: 0.45, visibility: 0.9 });
    setLandmark(reference, 'leftWrist', { x: 0.25, y: 0.58, visibility: 0.9 });
    setLandmark(reference, 'leftHip', { x: 0.42, y: 0.6, visibility: 0.9 });

    const live = blankLandmarks(0.9);
    setLandmark(live, 'leftShoulder', { x: 0.41, y: 0.32, visibility: 0.9 });
    setLandmark(live, 'leftElbow', { x: 0.22, y: 0.48, visibility: 0.9 });
    setLandmark(live, 'leftWrist', { x: 0.08, y: 0.72, visibility: 0.9 });
    setLandmark(live, 'leftHip', { x: 0.43, y: 0.62, visibility: 0.9 });

    const shaped = buildDecoupledPoseLandmarks(reference, live, 1.5);
    expect(getLandmark(shaped, 'leftHip')!.y).toBeCloseTo(0.6, 6);

    const refShoulder = { x: 0.4, y: 0.3 };
    const liveShoulder = { x: 0.41, y: 0.32 };
    const liveElbow = { x: 0.22, y: 0.48 };
    const liveWrist = { x: 0.08, y: 0.72 };
    const upper = Math.hypot(liveElbow.x - liveShoulder.x, liveElbow.y - liveShoulder.y);
    const fore = Math.hypot(liveWrist.x - liveElbow.x, liveWrist.y - liveElbow.y);
    const elbow = getLandmark(shaped, 'leftElbow')!;
    const wrist = getLandmark(shaped, 'leftWrist')!;
    expect(Math.hypot(elbow.x - refShoulder.x, elbow.y - refShoulder.y)).toBeCloseTo(upper * 1.5, 4);
    expect(Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y)).toBeCloseTo(fore * 1.5, 4);
  });
});
