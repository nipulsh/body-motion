import { describe, expect, it } from 'vitest';
import {
  HAND_POINTER_SENSITIVITY,
  PALM_LANDMARK_INDICES,
  handPointToViewport,
  palmCenter,
} from './handPointer';

function landmark(x: number, y: number) {
  return { x, y };
}

describe('palmCenter', () => {
  it('averages wrist and knuckle landmarks', () => {
    const points = Array.from({ length: 21 }, () => landmark(0, 0));
    points[0] = landmark(0.10, 0.50);
    points[5] = landmark(0.20, 0.40);
    points[9] = landmark(0.30, 0.40);
    points[13] = landmark(0.40, 0.40);
    points[17] = landmark(0.50, 0.50);

    const center = palmCenter(points);
    expect(center).not.toBeNull();
    expect(center!.x).toBeCloseTo(0.3, 10);
    expect(center!.y).toBeCloseTo(0.44, 10);
  });

  it('ignores fingertips when computing the palm', () => {
    const points = Array.from({ length: 21 }, () => landmark(0.4, 0.4));
    points[8] = landmark(0.9, 0.1);
    expect(palmCenter(points)).toEqual({ x: 0.4, y: 0.4 });
  });

  it('returns null when a palm landmark is missing', () => {
    expect(palmCenter([])).toBeNull();
    expect(palmCenter([landmark(0.2, 0.2)])).toBeNull();
  });
});

describe('handPointToViewport', () => {
  it('mirrors horizontally so a selfie camera follows the user', () => {
    const point = handPointToViewport({ x: 0, y: 0.5 }, 400, 800, { mirrorX: true, sensitivity: 1 });
    expect(point.x).toBeCloseTo(400, 5);
    expect(point.y).toBeCloseTo(400, 5);
  });

  it('maps a small palm move onto the full viewport', () => {
    const top = handPointToViewport({ x: 0.5, y: 0.5 - 0.5 / HAND_POINTER_SENSITIVITY }, 400, 800, {
      mirrorX: false,
    });
    const bottom = handPointToViewport(
      { x: 0.5, y: 0.5 + 0.5 / HAND_POINTER_SENSITIVITY },
      400,
      800,
      { mirrorX: false },
    );

    expect(top.x).toBeCloseTo(200, 5);
    expect(top.y).toBeCloseTo(0, 5);
    expect(bottom.y).toBeCloseTo(800, 5);
  });

  it('clamps amplified coordinates to the viewport', () => {
    const point = handPointToViewport({ x: 0.05, y: 0.05 }, 400, 800, {
      mirrorX: false,
      sensitivity: 4,
    });
    expect(point.x).toBe(0);
    expect(point.y).toBe(0);
  });
});

describe('PALM_LANDMARK_INDICES', () => {
  it('tracks palm joints rather than finger tips', () => {
    expect(PALM_LANDMARK_INDICES).toEqual([0, 5, 9, 13, 17]);
  });
});
