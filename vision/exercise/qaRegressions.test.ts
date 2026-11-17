/** Regression tests for the QA findings (written before the fixes). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import { summarizePosture } from '../pose/postureMetrics';
import { drawPoseWireframe } from '../pose/wireframe';
import { TimedCaptureController } from '../scanning/TimedCaptureController';
import { blankLandmarks, setLandmark } from '../test/fixtures';
import { recordingContext } from '../test/recordingContext';
import type { CapturedFrame, PoseLandmark, PoseResult } from '../types';
import { measureLungeForm } from './lungeForm';
import { applyRepAngleRanges, REP_ANGLE_RANGES, repAngleRangesFor } from './repAngleRanges';
import { RepDetector } from './RepDetector';
import { measureSquatForm, SquatFormMonitor } from './squatForm';
import { makeExercise, makeTrackingRule, snapshotWithAngles } from './testFixtures';

type Pts = Record<string, [number, number] | [number, number, number]>;

function body(over: Pts = {}, visibility = 0.95): PoseLandmark[] {
  const lm = blankLandmarks(0);
  const p: Pts = {
    nose: [0.5, 0.12, -0.3], leftEye: [0.53, 0.1, -0.3], rightEye: [0.47, 0.1, -0.3],
    leftEar: [0.56, 0.11, -0.1], rightEar: [0.44, 0.11, -0.1],
    leftShoulder: [0.62, 0.3], rightShoulder: [0.38, 0.3], leftElbow: [0.64, 0.45], rightElbow: [0.36, 0.45],
    leftWrist: [0.645, 0.6], rightWrist: [0.355, 0.6], leftHip: [0.56, 0.56], rightHip: [0.44, 0.56],
    leftKnee: [0.56, 0.74], rightKnee: [0.44, 0.74], leftAnkle: [0.56, 0.92], rightAnkle: [0.44, 0.92],
    leftHeel: [0.56, 0.94], rightHeel: [0.44, 0.94], leftFootIndex: [0.57, 0.95], rightFootIndex: [0.43, 0.95],
    ...over,
  };
  for (const [name, [x, y, z]] of Object.entries(p)) {
    setLandmark(lm, name as never, { x, y, z: z ?? 0, visibility });
  }
  return lm;
}

function rolled(lms: PoseLandmark[], deg: number): PoseLandmark[] {
  const t = (deg * Math.PI) / 180;
  return lms.map((lm) => ({
    ...lm,
    x: 0.5 + (lm.x - 0.5) * Math.cos(t) - (lm.y - 0.5) * Math.sin(t),
    y: 0.5 + (lm.x - 0.5) * Math.sin(t) + (lm.y - 0.5) * Math.cos(t),
  }));
}

const pose = (lm: PoseLandmark[], timestamp = 0): PoseResult => ({ landmarks: lm, confidence: 0.9, timestamp, frameAspect: 1 });

/** One foot stepped forward: nearer the camera, so it sits lower in the image. */
const staggered = () => body({ leftAnkle: [0.56, 0.97], leftHeel: [0.56, 0.99], leftFootIndex: [0.57, 1.0] });

describe('#1 staggered feet must not fake a shoulder tilt', () => {
  it('from the very first frame', () => {
    expect(measureSquatForm(pose(staggered()), { frameAspect: 1 })!.shoulderTilt!.deg).toBeLessThan(3);
  });

  it('after level frames', () => {
    const monitor = new SquatFormMonitor();
    for (let t = 0; t < 5; t++) monitor.update(pose(body(), t * 100), t * 100, 0, 1);
    const result = monitor.update(pose(staggered(), 600), 600, 0, 1);
    expect(result.frame!.shoulderTilt!.deg).toBeLessThan(3);
  });
});

describe('#2 knees that only straighten to ~150° still count', () => {
  it('counts squats from a 150° rest', () => {
    const ex = applyRepAngleRanges(
      makeExercise({
        id: 'library_squat', name: 'Squat', recommendedReps: 10,
        trackingRules: [makeTrackingRule({ joint: 'left_knee' }), makeTrackingRule({ joint: 'right_knee' })],
      }),
    );
    const detector = new RepDetector(ex);
    let t = 0;
    for (const a of [150, 135, 110, 95, 110, 135, 150, 120, 92, 120, 150]) {
      t += 300;
      detector.update(snapshotWithAngles({ left_knee: a, right_knee: a }, t));
    }
    expect(detector.getRepCount()).toBe(2);
  });
});

describe('#3 a missed rep says which joint fell short', () => {
  it('reports the knee that did not reach the window', () => {
    const ex = applyRepAngleRanges(
      makeExercise({
        id: 'library_squat', name: 'Squat', recommendedReps: 10,
        trackingRules: [makeTrackingRule({ joint: 'left_knee' }), makeTrackingRule({ joint: 'right_knee' })],
      }),
    );
    const detector = new RepDetector(ex);
    let t = 0;
    let last = '';
    for (const [l, r] of [[175, 175], [130, 135], [95, 106], [130, 135], [175, 175], [175, 175]]) {
      t += 300;
      last = detector.update(snapshotWithAngles({ left_knee: l!, right_knee: r! }, t)).feedback;
    }
    expect(detector.getRepCount()).toBe(0);
    expect(last).toMatch(/right knee/i);
    expect(last).toMatch(/106/);
    expect(last).toMatch(/80.?100/);
  });
});

describe('#4 (superseded) references are locked to the screen edges', () => {
  it('keeps the reference square to the screen while the camera rolls; tilt reads what the camera sees', () => {
    const monitor = new SquatFormMonitor();
    const tilted = () => body({ leftShoulder: [0.62, 0.31], rightShoulder: [0.38, 0.29] });
    let t = 0;
    let previous = -1;
    for (const roll of [0, 5, 10, 15, 20]) {
      t += 100;
      const frame = monitor.update(pose(rolled(tilted(), roll), t), t, 0, 1).frame!;
      expect(frame.upImage).toEqual({ x: 0, y: -1 });
      expect(frame.shoulderTilt!.deg).toBeGreaterThan(previous);
      previous = frame.shoulderTilt!.deg;
    }
  });
});

describe('#9 no feet in view', () => {
  it('keeps a screen-square reference without the feet', () => {
    const noFeet = body().map((lm, i) => (i >= 27 ? { ...lm, visibility: 0 } : lm));
    const frame = measureSquatForm(pose(noFeet), { frameAspect: 1 })!;
    expect(frame.upImage).toEqual({ x: 0, y: -1 });
    expect(frame.shoulderTilt!.deg).toBe(0);
  });

  it('keeps a screen-square reference with only the torso in view', () => {
    const torsoOnly = body().map((lm, i) => (i >= 25 ? { ...lm, visibility: 0 } : lm));
    expect(measureSquatForm(pose(torsoOnly), { frameAspect: 1 })!.upImage).toEqual({ x: 0, y: -1 });
  });

  it('a lunge that starts already in the lunge gets the same reference', () => {
    const inLunge = body({ rightKnee: [0.47, 0.74], rightAnkle: [0.4, 0.92], rightHeel: [0.4, 0.94], rightFootIndex: [0.39, 0.95] });
    const frame = measureLungeForm(pose(inLunge), { frameAspect: 1, leadSide: 'right' });
    expect(frame.shoulderTilt!.deg).toBe(0);
    expect(frame.upImage).toEqual({ x: 0, y: -1 });
  });
});

describe('#12 back-facing frames are not read as front-facing', () => {
  it('skips left/right tilt metrics when the face points away', () => {
    // Seen from behind with MediaPipe's guessed face: nose is behind the shoulders (larger z).
    const back = () => {
      const lm = body({ leftShoulder: [0.62, 0.31], rightShoulder: [0.38, 0.29] });
      for (const name of ['nose', 'leftEye', 'rightEye'] as const) {
        const i = { nose: 0, leftEye: 2, rightEye: 5 }[name];
        lm[i] = { ...lm[i]!, z: 0.3 };
      }
      return pose(lm);
    };
    const summary = summarizePosture(Array.from({ length: 5 }, back))!;
    expect(summary.frontalFrames).toBe(0);
    expect(summary.metrics.shoulderTiltDeg).toBeUndefined();
  });
});

describe('#14/#15 exercise name matching', () => {
  it('alternating lunges use the either-leg lunge window', () => {
    expect(repAngleRangesFor({ id: 'g', name: 'Alternating lunge, left and right' })).toBe(REP_ANGLE_RANGES.lunge);
    expect(repAngleRangesFor({ id: 'g', name: 'Alternating Reverse Lunges' })).toBe(REP_ANGLE_RANGES.lunge);
    expect(repAngleRangesFor({ id: 'g', name: 'Lunge (right)' })).toBe(REP_ANGLE_RANGES.lunge_right);
  });

  it('leg curls are not biceps curls', () => {
    for (const name of ['Standing hamstring curl', 'Seated leg curl', 'Wrist curl', 'Nordic curl']) {
      expect(repAngleRangesFor({ id: 'g', name })).toBeNull();
    }
    expect(repAngleRangesFor({ id: 'g', name: 'Hammer curl' })).toBe(REP_ANGLE_RANGES.elbow_flexion);
  });
});

describe('#18 face detail dots are off by default', () => {
  it('draws only the main face points unless asked', () => {
    const lm = body();
    for (const [name, x] of [['leftEyeInner', 0.52], ['mouthLeft', 0.52]] as const) {
      setLandmark(lm, name, { x, y: 0.15, visibility: 0.95 });
    }
    const plain = recordingContext();
    drawPoseWireframe(plain.ctx, lm);
    const detailed = recordingContext();
    drawPoseWireframe(detailed.ctx, lm, { faceDetail: true });
    expect(detailed.arcs.length).toBe(plain.arcs.length + 2);
  });
});

describe('#6 timed burst keeps its frame rate with slow pose detection', () => {
  const cfg = VISION_CONFIG.timedCapture;
  const { frameCount, frameIntervalMs } = cfg;
  const durationMs =
    cfg.stages.length * cfg.framesPerStage * frameIntervalMs +
    (cfg.stages.length - 1) * (cfg.turnPromptMs + cfg.countdownFrom * cfg.countdownStepMs);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('completes all frames and still attaches some poses', async () => {
    let detections = 0;
    const events: string[] = [];
    const controller = new TimedCaptureController({
      isCameraLive: () => true,
      getVideo: () => ({ readyState: 2 }) as HTMLVideoElement,
      captureFrame: async (): Promise<CapturedFrame> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { blob: new Blob(['f']), timestamp: Date.now(), width: 640, height: 480 };
      },
      emit: (event) => events.push(event),
      now: () => Date.now(),
      detectPose: () => {
        detections += 1;
        // A CPU pose pass blocks the main thread for ~150 ms, over the frame budget.
        vi.setSystemTime(Date.now() + 150);
        return pose(body());
      },
    });
    await controller.start();
    await vi.advanceTimersByTimeAsync(durationMs + 2000);
    expect(events).toContain('SCAN_COMPLETED');
    const images = controller.getSnapshot().capturedImages;
    expect(images).toHaveLength(frameCount);
    const withPose = images.filter((image) => image.pose).length;
    expect(withPose).toBeGreaterThanOrEqual(6);
    expect(detections).toBeLessThan(frameCount);
    void frameIntervalMs;
  });
});
