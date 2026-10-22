import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIST_CLICK_GATE,
  FistClickGate,
  isFistGesture,
  PrimaryHandTracker,
  type HandLandmark2D,
} from './fistGesture';

function hand(points: Partial<Record<number, HandLandmark2D>>): HandLandmark2D[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [index, point] of Object.entries(points)) {
    landmarks[Number(index)] = point!;
  }
  return landmarks;
}

/** Palm joints shared by the open, partial, and closed fixtures. */
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
    2: { x: 0.34, y: 0.66 },
    3: { x: 0.28, y: 0.58 },
    4: { x: 0.18, y: 0.48 },
    8: { x: 0.36, y: 0.28 },
    12: { x: 0.5, y: 0.22 },
    16: { x: 0.62, y: 0.3 },
    20: { x: 0.72, y: 0.38 },
  });
}

/** Fingers bent, tips still outside the knuckles, thumb still out. */
function partialCurl(): HandLandmark2D[] {
  return hand({
    ...palm(),
    2: { x: 0.34, y: 0.66 },
    3: { x: 0.28, y: 0.58 },
    4: { x: 0.18, y: 0.48 },
    8: { x: 0.42, y: 0.4 },
    12: { x: 0.5, y: 0.36 },
    16: { x: 0.62, y: 0.42 },
    20: { x: 0.7, y: 0.46 },
  });
}

/** Tips rest on the knuckles and the thumb lies across the fingers. */
function closedFist(): HandLandmark2D[] {
  return hand({
    ...palm(),
    2: { x: 0.38, y: 0.64 },
    3: { x: 0.36, y: 0.6 },
    4: { x: 0.44, y: 0.58 },
    8: { x: 0.41, y: 0.58 },
    12: { x: 0.5, y: 0.58 },
    16: { x: 0.57, y: 0.6 },
    20: { x: 0.64, y: 0.64 },
  });
}

function translate(landmarks: readonly HandLandmark2D[], dx: number): HandLandmark2D[] {
  return landmarks.map((point) => ({ x: point.x + dx, y: point.y }));
}

describe('isFistGesture', () => {
  it('detects a closed fist and rejects an open hand or a partial curl', () => {
    expect(isFistGesture(openHand())).toBe(false);
    expect(isFistGesture(partialCurl())).toBe(false);
    expect(isFistGesture(closedFist())).toBe(true);
  });
});

describe('FistClickGate', () => {
  it('clicks a closed fist and does not click an open hand or a partial curl', () => {
    const gate = new FistClickGate({
      ...DEFAULT_FIST_CLICK_GATE,
      fistHoldFrames: 2,
      openFramesRequired: 1,
      cooldownMs: 0,
      maxFistGapFrames: 0,
    });

    expect(gate.update(isFistGesture(openHand()), 0)).toBe(false);
    expect(gate.update(isFistGesture(partialCurl()), 10)).toBe(false);
    expect(gate.update(isFistGesture(partialCurl()), 20)).toBe(false);
    expect(gate.update(isFistGesture(closedFist()), 30)).toBe(false);
    expect(gate.update(isFistGesture(closedFist()), 40)).toBe(true);
    expect(gate.update(isFistGesture(closedFist()), 50)).toBe(false);
  });

  it('still clicks when one frame of a closing fist is missed', () => {
    const gate = new FistClickGate({
      ...DEFAULT_FIST_CLICK_GATE,
      fistHoldFrames: 3,
      cooldownMs: 0,
    });

    expect(gate.update(true, 0)).toBe(false);
    expect(gate.update(true, 10)).toBe(false);
    expect(gate.update(false, 20)).toBe(false);
    expect(gate.update(true, 30)).toBe(true);
  });

  it('emits one click per fist and debounces repeats', () => {
    const gate = new FistClickGate({
      ...DEFAULT_FIST_CLICK_GATE,
      fistHoldFrames: 1,
      openFramesRequired: 2,
      cooldownMs: 100,
    });

    let now = 0;
    expect(gate.update(false, now)).toBe(false);
    expect(gate.update(true, now + 10)).toBe(true);
    expect(gate.update(true, now + 20)).toBe(false);

    now = 200;
    expect(gate.update(false, now)).toBe(false);
    expect(gate.update(false, now + 10)).toBe(false);
    expect(gate.update(true, now + 120)).toBe(true);
    expect(gate.update(true, now + 130)).toBe(false);
  });
});

describe('PrimaryHandTracker', () => {
  it('keeps a closing fist when the other hand is listed first', () => {
    const tracker = new PrimaryHandTracker();
    const fist = closedFist();
    const other = translate(openHand(), -0.45);

    expect(tracker.select([{ landmarks: fist }])).toBe(fist);
    const chosen = tracker.select([{ landmarks: other }, { landmarks: fist }]);
    expect(chosen).toBe(fist);
    expect(isFistGesture(chosen!)).toBe(true);
  });

  it('does not click the other hand while the pointer hand stays open', () => {
    const tracker = new PrimaryHandTracker();
    const pointer = openHand();
    const otherFist = translate(closedFist(), -0.45);

    tracker.select([{ landmarks: pointer }]);
    const chosen = tracker.select([{ landmarks: otherFist }, { landmarks: pointer }]);
    expect(isFistGesture(chosen!)).toBe(false);
  });

  it('clicks from the only visible hand', () => {
    const tracker = new PrimaryHandTracker();
    const fist = closedFist();
    expect(isFistGesture(tracker.select([{ landmarks: fist }])!)).toBe(true);
  });

  it('does not adopt a distant hand while the pointer hand drops out', () => {
    const tracker = new PrimaryHandTracker();
    const fist = closedFist();
    const other = translate(openHand(), -0.45);

    tracker.select([{ landmarks: fist }]);
    expect(tracker.select([{ landmarks: other }])).toBeNull();
    expect(isFistGesture(tracker.select([{ landmarks: fist }])!)).toBe(true);
  });
});
