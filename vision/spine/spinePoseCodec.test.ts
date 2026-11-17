import { describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../config';
import type { PoseLandmark } from '../types';
import { decodeSimcc, keypointsToFrame, rgbaToInputTensor, spineCropFromLandmarks } from './spinePoseCodec';
import { SPINE_CHAIN_IDS, SPINE_CHAIN_LENGTH, SPINE_TRACK_KEYPOINTS } from './spineTrack';

const CONFIG = VISION_CONFIG.spinePose;
const INPUT_W = CONFIG.inputWidth;
const INPUT_H = CONFIG.inputHeight;

function landmarks(points: [number, number, number?][]): PoseLandmark[] {
  return points.map(([x, y, visibility = 0.9]) => ({ x, y, z: 0, visibility }));
}

/** Eight corners and midpoints spanning a pixel box, in normalized coordinates of a 1280×720 frame. */
function boxLandmarks(x1: number, y1: number, x2: number, y2: number): PoseLandmark[] {
  const xs = [x1, (x1 + x2) / 2, x2];
  const ys = [y1, (y1 + y2) / 2, y2];
  const points: [number, number][] = [];
  for (const y of ys) for (const x of xs) points.push([x / 1280, y / 720]);
  return landmarks(points);
}

describe('SpineTrack skeleton', () => {
  it('runs pelvis to skull through the nine spine keypoints the model names', () => {
    expect(SPINE_TRACK_KEYPOINTS).toBe(37);
    expect(SPINE_CHAIN_LENGTH).toBe(9);
    // hip, spine_01..05, neck, neck_02, neck_03: the order of the repo's SPINE_IDS.
    expect(SPINE_CHAIN_IDS).toEqual([19, 26, 27, 28, 29, 30, 18, 35, 36]);
  });
});

describe('spineCropFromLandmarks', () => {
  it('matches the repo: padded box, then widened to the model aspect around the same center', () => {
    // Box 200×400 centered at (200, 400). 12% pad on the long side adds 48 px all round: 296×496.
    // ×1.25 is 370×620. The model is 3:4, so the width grows to 465.
    const crop = spineCropFromLandmarks(boxLandmarks(100, 200, 300, 600), 1280, 720, CONFIG)!;
    expect(crop.height).toBeCloseTo(620, 0);
    expect(crop.width).toBeCloseTo(465, 0);
    expect(crop.x + crop.width / 2).toBeCloseTo(200, 0);
    expect(crop.y + crop.height / 2).toBeCloseTo(400, 0);
  });

  it('grows the height for a wide hinged body, so the crop keeps the model aspect', () => {
    const crop = spineCropFromLandmarks(boxLandmarks(200, 300, 800, 500), 1280, 720, CONFIG)!;
    expect(crop.width / crop.height).toBeCloseTo(INPUT_W / INPUT_H, 2);
    expect(crop.width).toBeGreaterThan(600);
  });

  it('may run past the frame edge rather than squeezing the body', () => {
    const crop = spineCropFromLandmarks(boxLandmarks(10, 20, 200, 700), 1280, 720, CONFIG)!;
    expect(crop.x).toBeLessThan(0);
    expect(crop.y).toBeLessThan(0);
    expect(crop.y + crop.height).toBeGreaterThan(720);
  });

  it('leaves out landmarks the model did not see', () => {
    const seen = boxLandmarks(100, 200, 300, 600);
    const withStray = [...seen, { x: 0.99, y: 0.99, z: 0, visibility: 0.01 }];
    expect(spineCropFromLandmarks(withStray, 1280, 720, CONFIG)).toEqual(spineCropFromLandmarks(seen, 1280, 720, CONFIG));
  });

  it('returns null when too little of the body is seen', () => {
    expect(spineCropFromLandmarks(landmarks([[0.5, 0.5]]), 1280, 720, CONFIG)).toBeNull();
    expect(spineCropFromLandmarks([], 1280, 720, CONFIG)).toBeNull();
  });

  it('returns null for a body too small to read and for a frame with no size', () => {
    expect(spineCropFromLandmarks(boxLandmarks(600, 300, 604, 304), 1280, 720, CONFIG)).toBeNull();
    expect(spineCropFromLandmarks(boxLandmarks(100, 200, 300, 600), 0, 0, CONFIG)).toBeNull();
  });

  it('ignores landmarks with coordinates that are not numbers', () => {
    const seen = boxLandmarks(100, 200, 300, 600);
    const poisoned = [...seen, { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 0, visibility: 0.9 }];
    expect(spineCropFromLandmarks(poisoned, 1280, 720, CONFIG)).toEqual(spineCropFromLandmarks(seen, 1280, 720, CONFIG));
  });
});

describe('rgbaToInputTensor', () => {
  it('produces planar RGB normalized with the model mean and std, and drops alpha', () => {
    const rgba = new Uint8ClampedArray(4 * 2);
    rgba.set([10, 20, 30, 255, 40, 50, 60, 0]);
    const tensor = rgbaToInputTensor(rgba, 2, 1, CONFIG.mean, CONFIG.std);
    expect(tensor).toHaveLength(6);
    expect(tensor[0]).toBeCloseTo((10 - 123.675) / 58.395, 4);
    expect(tensor[1]).toBeCloseTo((40 - 123.675) / 58.395, 4);
    expect(tensor[2]).toBeCloseTo((20 - 116.28) / 57.12, 4);
    expect(tensor[3]).toBeCloseTo((50 - 116.28) / 57.12, 4);
    expect(tensor[4]).toBeCloseTo((30 - 103.53) / 57.375, 4);
    expect(tensor[5]).toBeCloseTo((60 - 103.53) / 57.375, 4);
  });

  it('rejects a buffer that does not match the size', () => {
    expect(() => rgbaToInputTensor(new Uint8ClampedArray(7), 2, 1, CONFIG.mean, CONFIG.std)).toThrow();
  });
});

describe('decodeSimcc', () => {
  const X_BINS = INPUT_W * CONFIG.simccSplitRatio;
  const Y_BINS = INPUT_H * CONFIG.simccSplitRatio;

  it('takes each axis peak, halves the bin, and averages the two peak values', () => {
    const simccX = new Float32Array(2 * X_BINS);
    const simccY = new Float32Array(2 * Y_BINS);
    simccX[96] = 1.2;
    simccY[128] = 0.8;
    simccX[X_BINS + 10] = 0.5;
    simccY[Y_BINS + 500] = 0.7;
    const decoded = decodeSimcc(simccX, simccY, 2, X_BINS, Y_BINS, CONFIG.simccSplitRatio);
    expect(decoded.x[0]).toBe(48);
    expect(decoded.y[0]).toBe(64);
    expect(decoded.score[0]).toBeCloseTo(1.0, 5);
    expect(decoded.x[1]).toBe(5);
    expect(decoded.y[1]).toBe(250);
    expect(decoded.score[1]).toBeCloseTo(0.6, 5);
  });

  it('rejects outputs whose size does not match the declared shape', () => {
    expect(() => decodeSimcc(new Float32Array(3), new Float32Array(4), 2, X_BINS, Y_BINS, 2)).toThrow();
  });
});

describe('keypointsToFrame', () => {
  it('maps crop pixels back to normalized frame coordinates', () => {
    const crop = { x: 100, y: 50, width: 300, height: 400 };
    const mapped = keypointsToFrame(
      { x: new Float32Array([0, 96, 192]), y: new Float32Array([0, 128, 256]), score: new Float32Array([1, 0.5, 0.25]) },
      crop,
      1000,
      500,
      INPUT_W,
      INPUT_H,
    );
    expect(mapped[0]).toEqual({ x: 0.1, y: 0.1, score: 1 });
    expect(mapped[1]!.x).toBeCloseTo(0.25, 5);
    expect(mapped[1]!.y).toBeCloseTo(0.5, 5);
    expect(mapped[2]!.x).toBeCloseTo(0.4, 5);
    expect(mapped[2]!.y).toBeCloseTo(0.9, 5);
  });
});
