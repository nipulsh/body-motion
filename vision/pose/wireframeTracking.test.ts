import { describe, expect, it } from 'vitest';
import type { PoseLandmark } from '../types';
import { blankLandmarks, setLandmark } from '../test/fixtures';
import { recordingContext } from '../test/recordingContext';
import { drawPoseWireframe, WIREFRAME_MIN_VISIBILITY } from './wireframe';
import { cameraToBody, DEFAULT_MIRROR_GEOMETRY } from './mirrorReflection';
import {
  DistanceTracker,
  estimateEyeBody,
  EyePositionTracker,
  eyeImagePoint,
  LandmarkVisibilityGate,
  StandingEyeTracker,
} from './wireframeTracking';

const FRAME_MS = 33;

describe('eyeImagePoint', () => {
  it('averages the reliable eyes and ignores weak ones', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftEye', { x: 0.4, y: 0.2, visibility: 0.9 });
    setLandmark(landmarks, 'rightEye', { x: 0.6, y: 0.24, visibility: 0.9 });
    expect(eyeImagePoint(landmarks)).toEqual({ x: 0.5, y: 0.22 });

    setLandmark(landmarks, 'rightEye', { x: 0.6, y: 0.24, visibility: 0.1 });
    expect(eyeImagePoint(landmarks)).toEqual({ x: 0.4, y: 0.2 });

    setLandmark(landmarks, 'leftEye', { x: 0.4, y: 0.2, visibility: 0.1 });
    expect(eyeImagePoint(landmarks)).toBeNull();
    expect(eyeImagePoint(null)).toBeNull();
  });
});

describe('EyePositionTracker', () => {
  const fallback = { x: 0, h: 63 };

  function run(tracker: EyePositionTracker, measured: { x: number; h: number } | null, clock: { now: number }, frames: number) {
    const out: Array<{ x: number; h: number }> = [];
    for (let i = 0; i < frames; i += 1) {
      clock.now += FRAME_MS;
      out.push({ ...tracker.update(measured, clock.now) });
    }
    return out;
  }

  it('starts at the standing default before eyes are seen', () => {
    const tracker = new EyePositionTracker(fallback);
    expect(tracker.update(null, 0)).toEqual(fallback);
  });

  it('follows the eyes down smoothly when the person bends', () => {
    const tracker = new EyePositionTracker(fallback);
    const clock = { now: 0 };
    run(tracker, { x: 0, h: 62 }, clock, 30);
    const path = run(tracker, { x: 0, h: 40 }, clock, 40);
    expect(path[0]!.h).toBeLessThan(62);
    expect(path[0]!.h).toBeGreaterThan(50);
    for (let i = 1; i < path.length; i += 1) expect(path[i]!.h).toBeLessThanOrEqual(path[i - 1]!.h);
    expect(path.at(-1)!.h).toBeCloseTo(40, 1);
  });

  it('holds, then eases back, when the eyes drop out, without jumps', () => {
    const tracker = new EyePositionTracker(fallback);
    const clock = { now: 0 };
    run(tracker, { x: 3, h: 45 }, clock, 60);

    const held = run(tracker, null, clock, 15);
    for (const value of held) expect(value.h).toBeCloseTo(45, 1);

    const easing = run(tracker, null, clock, 120);
    let previous = held.at(-1)!.h;
    for (const value of easing) {
      expect(value.h - previous).toBeGreaterThanOrEqual(-1e-9);
      expect(value.h - previous).toBeLessThan(3);
      expect(value.x).toBeCloseTo(3, 1);
      previous = value.h;
    }
    expect(previous).toBeCloseTo(63, 0);

    // Gone for over 3 s: the next person's eyes are used directly, not glided to.
    expect(run(tracker, { x: 3, h: 50 }, clock, 1)[0]!.h).toBe(50);
  });

  it('recovers smoothly after a short gap', () => {
    const tracker = new EyePositionTracker(fallback);
    const clock = { now: 0 };
    run(tracker, { x: 0, h: 45 }, clock, 30);
    run(tracker, null, clock, 40);
    let previous = tracker.position.h;
    expect(previous).toBeGreaterThan(45);
    for (const value of run(tracker, { x: 0, h: 45 }, clock, 30)) {
      expect(Math.abs(value.h - previous)).toBeLessThan(6);
      previous = value.h;
    }
    expect(previous).toBeCloseTo(45, 0);
  });

  it('takes a new person first eye estimate as-is instead of gliding from the default', () => {
    const tracker = new EyePositionTracker(fallback);
    tracker.update(null, 0);
    expect(tracker.update({ x: 1, h: 56 }, 33)).toEqual({ x: 1, h: 56 });
  });
});

describe('estimateEyeBody', () => {
  const FRAME = { width: 1280, height: 720 };
  const GEOMETRY = { ...DEFAULT_MIRROR_GEOMETRY, cameraTiltDownDeg: 0 };
  const D = GEOMETRY.userDistanceIn;
  const heightAt = (y: number) => cameraToBody({ x: 0.5, y }, FRAME, GEOMETRY, D)!.h;

  function head(visibility: Partial<Record<'eyes' | 'ears' | 'nose' | 'shoulders', number>>, dy = 0) {
    const landmarks = blankLandmarks(0);
    const v = { eyes: 0, ears: 0, nose: 0, shoulders: 0, ...visibility };
    setLandmark(landmarks, 'leftEye', { x: 0.5, y: 0.2 + dy, visibility: v.eyes });
    setLandmark(landmarks, 'rightEye', { x: 0.5, y: 0.2 + dy, visibility: v.eyes });
    setLandmark(landmarks, 'leftEar', { x: 0.5, y: 0.21 + dy, visibility: v.ears });
    setLandmark(landmarks, 'rightEar', { x: 0.5, y: 0.21 + dy, visibility: v.ears });
    setLandmark(landmarks, 'nose', { x: 0.5, y: 0.23 + dy, visibility: v.nose });
    setLandmark(landmarks, 'leftShoulder', { x: 0.45, y: 0.4 + dy, visibility: v.shoulders });
    setLandmark(landmarks, 'rightShoulder', { x: 0.55, y: 0.4 + dy, visibility: v.shoulders });
    return landmarks;
  }

  it('uses the eyes when they are reliable', () => {
    const all = head({ eyes: 0.9, ears: 0.9, nose: 0.9, shoulders: 0.9 });
    expect(estimateEyeBody(all, FRAME, GEOMETRY, D)!.h).toBeCloseTo(heightAt(0.2), 6);
  });

  it('falls back to the ears, then the nose, then the shoulders when the eyes are lost', () => {
    expect(estimateEyeBody(head({ ears: 0.9, nose: 0.9 }), FRAME, GEOMETRY, D)!.h).toBeCloseTo(heightAt(0.21), 6);
    expect(estimateEyeBody(head({ nose: 0.9 }), FRAME, GEOMETRY, D)!.h).toBeCloseTo(heightAt(0.23) + 1.5, 6);
    expect(estimateEyeBody(head({ shoulders: 0.9 }), FRAME, GEOMETRY, D)!.h).toBeCloseTo(heightAt(0.4) + 9, 6);
  });

  it('keeps tracking a crouched viewer who looks down (eyes lost, body visible)', () => {
    const tracker = new EyePositionTracker({ x: 0, h: 63 });
    // Head low in the image: about 40" from the floor.
    const crouched = head({ eyes: 0.9, nose: 0.9, shoulders: 0.9 }, 0.32);
    const lookingDown = head({ eyes: 0.1, nose: 0.9, shoulders: 0.9 }, 0.32);
    let now = 0;
    for (let i = 0; i < 30; i += 1) tracker.update(estimateEyeBody(crouched, FRAME, GEOMETRY, D), (now += 33));
    const before = tracker.position.h;
    for (let i = 0; i < 90; i += 1) tracker.update(estimateEyeBody(lookingDown, FRAME, GEOMETRY, D), (now += 33));
    // 3 s later the viewpoint is still the crouched head, not the 63" standing default.
    expect(Math.abs(tracker.position.h - before)).toBeLessThan(3);
    expect(tracker.position.h).toBeLessThan(48);
  });

  it('needs both shoulders for the shoulder fallback, and returns null with nothing reliable', () => {
    const one = head({});
    setLandmark(one, 'leftShoulder', { x: 0.45, y: 0.4, visibility: 0.9 });
    expect(estimateEyeBody(one, FRAME, GEOMETRY, D)).toBeNull();
    expect(estimateEyeBody(head({}), FRAME, GEOMETRY, D)).toBeNull();
    expect(estimateEyeBody(null, FRAME, GEOMETRY, D)).toBeNull();
  });
});

describe('DistanceTracker', () => {
  const FRAME = { width: 1280, height: 720 };
  const GEOMETRY = { ...DEFAULT_MIRROR_GEOMETRY, cameraTiltDownDeg: 0 };

  /** Shoulders `widthIn` apart at camera height, seen from `distanceIn`. */
  function shoulders(distanceIn: number, widthIn = GEOMETRY.shoulderWidthIn) {
    const focal =
      Math.hypot(FRAME.width, FRAME.height) / 2 / Math.tan((GEOMETRY.cameraDiagonalFovDeg * Math.PI) / 360);
    const dx = ((widthIn / 2 / distanceIn) * focal) / FRAME.width;
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.5 + dx, y: 0.5, visibility: 0.9 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.5 - dx, y: 0.5, visibility: 0.9 });
    return landmarks;
  }

  it('starts at the default and takes the first measurement directly', () => {
    const tracker = new DistanceTracker(55);
    expect(tracker.distanceIn).toBe(55);
    expect(tracker.update(shoulders(48), FRAME, GEOMETRY, 0)).toBeCloseTo(48, 6);
  });

  it('follows the viewer stepping back smoothly', () => {
    const tracker = new DistanceTracker(55);
    let now = 0;
    tracker.update(shoulders(50), FRAME, GEOMETRY, now);
    let previous = 50;
    for (let i = 0; i < 150; i += 1) {
      const value = tracker.update(shoulders(60), FRAME, GEOMETRY, (now += 33));
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(value - previous).toBeLessThan(1.5);
      previous = value;
    }
    expect(previous).toBeCloseTo(60, 1);
  });

  it('ignores a brief sideways turn that narrows the shoulders', () => {
    const tracker = new DistanceTracker(55);
    let now = 0;
    for (let i = 0; i < 30; i += 1) tracker.update(shoulders(55), FRAME, GEOMETRY, (now += 33));
    const narrow = shoulders(55, GEOMETRY.shoulderWidthIn * 0.6);
    for (let i = 0; i < 20; i += 1) tracker.update(narrow, FRAME, GEOMETRY, (now += 33));
    expect(tracker.distanceIn).toBeCloseTo(55, 1);
  });

  it('holds the last distance when the shoulders are not visible', () => {
    const tracker = new DistanceTracker(55);
    tracker.update(shoulders(50), FRAME, GEOMETRY, 0);
    expect(tracker.update(blankLandmarks(0), FRAME, GEOMETRY, 33)).toBeCloseTo(50, 6);
    expect(tracker.update(null, FRAME, GEOMETRY, 66)).toBeCloseTo(50, 6);
  });
});

describe('StandingEyeTracker', () => {
  it('learns each viewer own standing eye height', () => {
    const tracker = new StandingEyeTracker();
    expect(tracker.update(null, 0)).toBeNull();
    expect(tracker.update({ x: 0, h: 56 }, 33)).toBe(56);
    // Bending down does not lower it.
    expect(tracker.update({ x: 0, h: 40 }, 66)).toBe(56);
    expect(tracker.update({ x: 0, h: 57 }, 99)).toBe(57);
  });

  it('forgets it after the viewer has been gone for a while', () => {
    const tracker = new StandingEyeTracker(3000);
    tracker.update({ x: 0, h: 68 }, 0);
    expect(tracker.update(null, 2000)).toBe(68);
    expect(tracker.update(null, 3100)).toBeNull();
    expect(tracker.update({ x: 0, h: 56 }, 3200)).toBe(56);
  });
});

describe('landmark visibility hysteresis', () => {
  function scored(score: number): PoseLandmark[] {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.3, y: 0.4, visibility: score });
    return landmarks;
  }
  const SHOULDER = 11;

  it('shows at the floor and hides only after a clear drop', () => {
    const gate = new LandmarkVisibilityGate();
    const shown = [0.19, 0.2, 0.17, 0.13, 0.11, 0.19, 0.2].map((score) => gate.update(scored(score))[SHOULDER]);
    expect(shown).toEqual([false, true, true, true, false, false, true]);
  });

  it('toggles far less than the stateless floor when the score jitters', () => {
    const gate = new LandmarkVisibilityGate();
    const scores = Array.from({ length: 40 }, (_, i) => WIREFRAME_MIN_VISIBILITY + (i % 2 === 0 ? 0.03 : -0.03));
    const gated = scores.map((score) => gate.update(scored(score))[SHOULDER]);
    const stateless = scores.map((score) => score >= WIREFRAME_MIN_VISIBILITY);
    const toggles = (values: boolean[]) => values.slice(1).filter((value, i) => value !== values[i]).length;
    expect(toggles(stateless)).toBeGreaterThan(30);
    expect(toggles(gated)).toBe(0);
  });

  it('never shows a landmark the detector did not place', () => {
    const gate = new LandmarkVisibilityGate();
    gate.update(scored(0.9));
    expect(gate.update(null)).toEqual([]);
    expect(gate.update(scored(0))[SHOULDER]).toBe(false);
  });

  it('drives drawPoseWireframe through visibleMask', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.2, y: 0.5, visibility: 0.15 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.8, y: 0.5, visibility: 0.15 });
    const mask: boolean[] = [];
    mask[11] = true;
    mask[12] = true;

    const stateless = recordingContext();
    drawPoseWireframe(stateless.ctx, landmarks);
    expect(stateless.lines).toEqual([]);

    const gated = recordingContext();
    drawPoseWireframe(gated.ctx, landmarks, { visibleMask: mask });
    expect(gated.lines).toEqual([{ x1: 20, y1: 50, x2: 80, y2: 50 }]);
  });
});
