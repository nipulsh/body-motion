import { describe, expect, it } from 'vitest';
import type { HandLandmark2D } from './fistGesture';
import { isFistGesture } from './fistGesture';
import {
  PinchManipulator,
  isPinchGesture,
  pinchDragToViewport,
} from './pinchGesture';

function hand(points: Partial<Record<number, HandLandmark2D>>): HandLandmark2D[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [index, point] of Object.entries(points)) {
    landmarks[Number(index)] = point!;
  }
  return landmarks;
}

function palm(): Partial<Record<number, HandLandmark2D>> {
  return {
    0: { x: 0.5, y: 0.72 },
    5: { x: 0.4, y: 0.56 },
    6: { x: 0.38, y: 0.46 },
    9: { x: 0.5, y: 0.54 },
    10: { x: 0.5, y: 0.42 },
    13: { x: 0.58, y: 0.56 },
    14: { x: 0.6, y: 0.46 },
    17: { x: 0.66, y: 0.6 },
    18: { x: 0.68, y: 0.5 },
  };
}

function openHand(): HandLandmark2D[] {
  return hand({
    ...palm(),
    4: { x: 0.18, y: 0.48 },
    8: { x: 0.36, y: 0.28 },
    12: { x: 0.5, y: 0.22 },
    16: { x: 0.62, y: 0.3 },
    20: { x: 0.72, y: 0.38 },
  });
}

function closedFist(): HandLandmark2D[] {
  return hand({
    ...palm(),
    4: { x: 0.44, y: 0.58 },
    8: { x: 0.41, y: 0.58 },
    12: { x: 0.5, y: 0.58 },
    16: { x: 0.57, y: 0.6 },
    20: { x: 0.64, y: 0.64 },
  });
}

/** Thumb and index meet; middle, ring, and little fingers stay extended. */
function pinchHand(): HandLandmark2D[] {
  return hand({
    ...palm(),
    4: { x: 0.37, y: 0.36 },
    8: { x: 0.39, y: 0.36 },
    12: { x: 0.5, y: 0.22 },
    16: { x: 0.62, y: 0.3 },
    20: { x: 0.72, y: 0.38 },
  });
}

function translate(landmarks: readonly HandLandmark2D[], dx: number, dy = 0): HandLandmark2D[] {
  return landmarks.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

describe('isPinchGesture', () => {
  it('accepts a thumb-index pinch with the other fingers open', () => {
    expect(isPinchGesture(pinchHand())).toBe(true);
    expect(isFistGesture(pinchHand())).toBe(false);
  });

  it('rejects an open palm, a fist, and a pinch with a curled finger', () => {
    expect(isPinchGesture(openHand())).toBe(false);
    expect(isPinchGesture(closedFist())).toBe(false);

    const middleCurled = pinchHand();
    middleCurled[12] = { x: 0.5, y: 0.56 };
    expect(isPinchGesture(middleCurled)).toBe(false);
  });
});

describe('PinchManipulator', () => {
  it('emits drag only after the pinched hand moves', () => {
    const manipulator = new PinchManipulator();
    const pinch = pinchHand();

    expect(manipulator.update([{ landmarks: pinch }])).toMatchObject({
      pinching: true,
      drag: null,
      zoom: null,
    });
    expect(manipulator.update([{ landmarks: translate(pinch, 0.002) }]).drag).toBeNull();

    const drag = manipulator.update([{ landmarks: translate(pinch, 0.02) }]).drag;
    expect(drag?.dx).toBeCloseTo(0.02, 5);
    expect(drag?.dy).toBeCloseTo(0, 5);
  });

  it('zooms in when the hands spread and out when they come together', () => {
    const manipulator = new PinchManipulator();
    const pinch = pinchHand();
    const near = translate(openHand(), -0.35);

    expect(manipulator.update([{ landmarks: pinch }, { landmarks: near }])).toMatchObject({
      pinching: true,
      drag: null,
      zoom: null,
    });

    const apart = manipulator.update([
      { landmarks: pinch },
      { landmarks: translate(openHand(), -0.5) },
    ]);
    expect(apart.drag).toBeNull();
    expect(apart.zoom).toBeGreaterThan(1);

    const together = manipulator.update([
      { landmarks: pinch },
      { landmarks: translate(openHand(), -0.38) },
    ]);
    expect(together.zoom).toBeLessThan(1);
  });

  it('emits nothing for two open hands', () => {
    const manipulator = new PinchManipulator();
    const frame = manipulator.update([
      { landmarks: openHand() },
      { landmarks: translate(openHand(), -0.4) },
    ]);
    expect(frame).toMatchObject({ pinching: false, drag: null, zoom: null, palm: null });
  });

  it('returns to drag when the second hand leaves', () => {
    const manipulator = new PinchManipulator();
    const pinch = pinchHand();
    manipulator.update([{ landmarks: pinch }, { landmarks: translate(openHand(), -0.4) }]);

    const resumed = manipulator.update([{ landmarks: translate(pinch, 0.04) }]);
    expect(resumed.zoom).toBeNull();
    expect(resumed.drag?.dx).toBeCloseTo(0.04, 5);
    expect(resumed.drag?.dy).toBeCloseTo(0, 5);
  });
});

describe('pinchDragToViewport', () => {
  it('flips camera X into selfie-mirror pixels', () => {
    expect(pinchDragToViewport({ dx: 0.1, dy: 0.2 }, 1000, 500)).toEqual({
      x: -0.1 * 2.6 * 1000,
      y: 0.2 * 2.6 * 500,
    });
    expect(pinchDragToViewport({ dx: 0.1, dy: 0.2 }, 0, 500)).toEqual({ x: 0, y: 0 });
  });
});
