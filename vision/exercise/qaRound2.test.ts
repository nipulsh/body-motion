/** Regression tests for the second QA round (written before the fixes). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import { TimedCaptureController } from '../scanning/TimedCaptureController';
import { blankLandmarks, setLandmark } from '../test/fixtures';
import type { CapturedFrame, PoseLandmark, PoseResult } from '../types';
import { applyRepAngleRanges } from './repAngleRanges';
import { RepDetector } from './RepDetector';
import { measureSquatForm } from './squatForm';
import { makeExercise, makeTrackingRule, snapshotWithAngles } from './testFixtures';

type Pts = Record<string, [number, number]>;
function body(over: Pts = {}): PoseLandmark[] {
  const lm = blankLandmarks(0);
  const p: Pts = {
    nose: [0.5, 0.12], leftEye: [0.53, 0.1], rightEye: [0.47, 0.1],
    leftShoulder: [0.62, 0.3], rightShoulder: [0.38, 0.3], leftHip: [0.56, 0.56], rightHip: [0.44, 0.56],
    leftKnee: [0.56, 0.74], rightKnee: [0.44, 0.74], leftAnkle: [0.56, 0.92], rightAnkle: [0.44, 0.92],
    leftHeel: [0.56, 0.94], rightHeel: [0.44, 0.94], leftFootIndex: [0.57, 0.95], rightFootIndex: [0.43, 0.95],
    ...over,
  };
  for (const [n, [x, y]] of Object.entries(p)) setLandmark(lm, n as never, { x, y, z: 0, visibility: 0.95 });
  return lm;
}
const P = (lm: PoseLandmark[], t = 0): PoseResult => ({ landmarks: lm, confidence: 0.9, timestamp: t, frameAspect: 1 });

function squat() {
  return applyRepAngleRanges(
    makeExercise({
      id: 'library_squat', name: 'Squat', recommendedReps: 10,
      trackingRules: [makeTrackingRule({ joint: 'left_knee' }), makeTrackingRule({ joint: 'right_knee' })],
    }),
  );
}

function feed(detector: RepDetector, pairs: Array<[number, number]>, stepMs = 100) {
  let t = 0;
  let last = detector.update(snapshotWithAngles({ left_knee: pairs[0]![0], right_knee: pairs[0]![1] }, t));
  const feedback: string[] = [];
  for (const [l, r] of pairs.slice(1)) {
    t += stepMs;
    last = detector.update(snapshotWithAngles({ left_knee: l, right_knee: r }, t));
    feedback.push(last.feedback);
  }
  return { last, feedback };
}

const hold = (angle: number, ms: number, stepMs = 100): Array<[number, number]> =>
  Array.from({ length: Math.round(ms / stepMs) }, () => [angle, angle]);
const ramp = (from: number, to: number, step = 8): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  const n = Math.ceil(Math.abs(to - from) / step);
  for (let i = 1; i <= n; i++) out.push([from + ((to - from) * i) / n, from + ((to - from) * i) / n]);
  return out;
};

describe('#1 a real sideways hip shift is not read as a shoulder tilt', () => {
  it('keeps the level feet as reference and reports the lean as a lean', () => {
    // Shoulders and hips moved together over the right foot; feet planted level.
    const shifted = body({
      leftShoulder: [0.54, 0.3], rightShoulder: [0.3, 0.3], leftHip: [0.48, 0.56], rightHip: [0.36, 0.56],
      leftKnee: [0.52, 0.74], rightKnee: [0.4, 0.74],
    });
    const frame = measureSquatForm(P(shifted), { frameAspect: 1 })!;
    expect(frame.shoulderTilt!.deg).toBeLessThan(2);
    expect(frame.pelvisTilt!.deg).toBeLessThan(2);
  });
});

describe('#2 users who rest with knees bent below 145°', () => {
  it('counts squats after holding a 130° rest for a moment', () => {
    const detector = new RepDetector(squat());
    const { last } = feed(detector, [
      ...hold(130, 1500),
      ...ramp(130, 90), ...ramp(90, 130), ...hold(130, 300),
      ...ramp(130, 92), ...ramp(92, 130), ...hold(130, 300),
    ]);
    expect(last.repCount).toBe(2);
  });

  it('does not adopt a resting angle too close to the target', () => {
    const detector = new RepDetector(squat());
    const { last } = feed(detector, [...hold(108, 1500), ...ramp(108, 90), ...ramp(90, 108), ...hold(108, 300)]);
    expect(last.repCount).toBe(0);
  });
});

describe('#3 missed-rep feedback', () => {
  it('stays quiet for a small weight shift', () => {
    const detector = new RepDetector(squat());
    const { last } = feed(detector, [[170, 170], [170, 170], [140, 140], [170, 170], [170, 170]]);
    expect(last.feedback).not.toMatch(/not counted/i);
  });

  it('names the lagging knee while the patient is still going down', () => {
    const detector = new RepDetector(squat());
    const { feedback } = feed(detector, [[175, 175], [175, 175], [130, 135], [95, 115]]);
    expect(feedback[feedback.length - 1]).toMatch(/right knee/i);
  });

  it('still reports a real attempt that fell short on one side', () => {
    const detector = new RepDetector(squat());
    const { last } = feed(detector, [[175, 175], [175, 175], [130, 135], [95, 108], [130, 135], [175, 175]]);
    expect(last.feedback).toMatch(/right knee reached 108/i);
  });
});

describe('#6 burst pose sampling recovers after a slow start', () => {
  const cfg = VISION_CONFIG.timedCapture;
  const { frameCount } = cfg;
  // All stages' frames plus the turn prompt and count between stages.
  const durationMs =
    cfg.stages.length * cfg.framesPerStage * cfg.frameIntervalMs +
    (cfg.stages.length - 1) * (cfg.turnPromptMs + cfg.countdownFrom * cfg.countdownStepMs);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('returns to posing most frames once detection is fast, spread over the whole burst', async () => {
    let calls = 0;
    const controller = new TimedCaptureController({
      isCameraLive: () => true,
      getVideo: () => ({ readyState: 2 }) as HTMLVideoElement,
      captureFrame: async (): Promise<CapturedFrame> => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { blob: new Blob(['f']), timestamp: Date.now(), width: 640, height: 480 };
      },
      emit: () => undefined,
      now: () => Date.now(),
      detectPose: () => {
        calls += 1;
        // First passes warm the GPU (slow), then detection is fast.
        vi.setSystemTime(Date.now() + (calls <= 2 ? 400 : 15));
        return P(body());
      },
    });
    await controller.start();
    await vi.advanceTimersByTimeAsync(durationMs + 3000);
    const images = controller.getSnapshot().capturedImages;
    expect(images).toHaveLength(frameCount);
    const posed = images.map((image, i) => (image.pose ? i : -1)).filter((i) => i >= 0);
    expect(posed.length).toBeGreaterThanOrEqual(frameCount * 0.4);
    expect(posed.filter((i) => i >= frameCount - 10).length).toBeGreaterThanOrEqual(3);
  });
});

describe('#9 (superseded) lunge overlay references are screen-square', () => {
  it('draws a horizontal shoulder reference and no feet notice when only the torso is visible', async () => {
    const { measureLungeForm } = await import('./lungeForm');
    const { drawLungeFormOverlay } = await import('./lungeFormOverlay');
    const { recordingContext } = await import('../test/recordingContext');
    const torso = body().map((lm, i) => (i >= 25 ? { ...lm, visibility: 0 } : lm));
    const frame = measureLungeForm(P(torso), { frameAspect: 1, leadSide: 'right' });
    expect(frame.upImage).toEqual({ x: 0, y: -1 });
    const rec = recordingContext(400, 400);
    const labels: string[] = [];
    Object.assign(rec.ctx, { measureText: () => ({ width: 10 }), setLineDash() {}, roundRect() {}, fillText: (t: string) => labels.push(t) });
    drawLungeFormOverlay(rec.ctx, torso, { frame, faults: [], correctReps: 0, incorrectReps: 0 }, {});
    expect(labels.some((label) => /feet/i.test(label))).toBe(false);
    const shoulderY = 0.3 * 400;
    expect(rec.lines.some((l) => Math.abs(l.y1 - shoulderY) < 0.5 && Math.abs(l.y2 - shoulderY) < 0.5)).toBe(true);
  });
});

describe('#12 back-facing detection prefers metric depth', () => {
  const withDepth = (imageNoseZ: number, worldNoseZ: number) => {
    const lm = body({ leftShoulder: [0.62, 0.31], rightShoulder: [0.38, 0.29] });
    for (const i of [0, 2, 5]) lm[i] = { ...lm[i]!, z: imageNoseZ };
    const world = lm.map((p) => ({ ...p, x: p.x - 0.5, y: p.y - 0.5, z: 0 }));
    for (const i of [0, 2, 5]) world[i] = { ...world[i]!, z: worldNoseZ };
    return { ...P(lm), worldLandmarks: world };
  };

  it('treats a frame as back-facing when world depth puts the nose behind the shoulders', async () => {
    const { summarizePosture } = await import('../pose/postureMetrics');
    const summary = summarizePosture(Array.from({ length: 4 }, () => withDepth(-0.3, 0.12)))!;
    expect(summary.frontalFrames).toBe(0);
  });

  it('treats a frame as front-facing when world depth puts the nose in front', async () => {
    const { summarizePosture } = await import('../pose/postureMetrics');
    const summary = summarizePosture(Array.from({ length: 4 }, () => withDepth(0.3, -0.12)))!;
    expect(summary.frontalFrames).toBe(4);
  });
});

describe('#18 face detail appears automatically when the face is large enough', () => {
  it('draws the extra face points on a large face and not on a small one', async () => {
    const { drawPoseWireframe, WIREFRAME_FACE_DETAIL_JOINTS } = await import('../pose/wireframe');
    const { recordingContext } = await import('../test/recordingContext');
    const lm = body();
    for (const name of WIREFRAME_FACE_DETAIL_JOINTS) setLandmark(lm, name, { x: 0.5, y: 0.13, z: 0, visibility: 0.95 });
    const small = recordingContext(100, 100);
    drawPoseWireframe(small.ctx, lm);
    const large = recordingContext(1200, 1200);
    drawPoseWireframe(large.ctx, lm);
    expect(large.arcs.length - small.arcs.length).toBe(WIREFRAME_FACE_DETAIL_JOINTS.length);
  });
});
