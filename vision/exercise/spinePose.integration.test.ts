/**
 * Integration: video frame → crop → SimCC decode → SpinePoseEstimator → ExerciseSessionController
 * → DeadliftFormMonitor → FaultTimer → overlay. Everything real except the neural network and the
 * bitmap: the fake model turns scripted body poses into SimCC tensors through the crop it was given,
 * so the crop and decode math run for real in both directions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import type { MotionTracker } from '../motion/MotionTracker';
import { resetNeutralSpineProfile } from '../posture/NeutralSpineCalibrator';
import { decodeSimcc, type SpineCrop } from '../spine/spinePoseCodec';
import { SpinePoseEstimator, type SpinePoseRunner } from '../spine/SpinePoseEstimator';
import { SPINE_CHAIN_IDS, SPINE_TRACK_KEYPOINTS } from '../spine/spineTrack';
import { H, hinge, W, type HingeOptions } from '../test/deadliftHinge';
import { recordingContext } from '../test/recordingContext';
import { chainFor, simccAxis, type ChainOptions } from '../test/spineChain';
import { ExerciseSessionController, type ExerciseFramePayload } from './ExerciseSessionController';
import { drawExerciseFormOverlay } from './formOverlay';
import { makeExercise } from './testFixtures';

const CONFIG = VISION_CONFIG.spinePose;
const DEADLIFT = makeExercise({ id: 'library_deadlift', name: 'Deadlift', formCheck: 'deadlift' });
const SQUAT = makeExercise({ id: 'library_squat', name: 'Squat', formCheck: 'squat' });
const X_BINS = CONFIG.inputWidth * CONFIG.simccSplitRatio;
const Y_BINS = CONFIG.inputHeight * CONFIG.simccSplitRatio;

/** The body the camera sees right now, read by both the fake camera and the fake model. */
interface Scene {
  body: HingeOptions;
  chain: ChainOptions;
  /** Rejects when set, as a crashed model would. */
  modelError?: Error;
}

function harness(scene: Scene) {
  const runner: SpinePoseRunner = {
    load: async () => {},
    dispose: vi.fn(),
    run: async (frame) => {
      if (scene.modelError) throw scene.modelError;
      const crop = (frame as unknown as { crop: SpineCrop }).crop;
      const spine = chainFor({ leanDeg: scene.body.leanDeg, facing: scene.body.facing, ...scene.chain });
      const simccX = new Float32Array(SPINE_TRACK_KEYPOINTS * X_BINS);
      const simccY = new Float32Array(SPINE_TRACK_KEYPOINTS * Y_BINS);
      const score = spine.points[0]!.score;
      SPINE_CHAIN_IDS.forEach((id, order) => {
        const point = spine.points[order]!;
        const inputX = (((point.x * W - crop.x) / crop.width) * CONFIG.inputWidth) * CONFIG.simccSplitRatio;
        const inputY = (((point.y * H - crop.y) / crop.height) * CONFIG.inputHeight) * CONFIG.simccSplitRatio;
        simccX.set(simccAxis(inputX, X_BINS, score), id * X_BINS);
        simccY.set(simccAxis(inputY, Y_BINS, score), id * Y_BINS);
      });
      return decodeSimcc(simccX, simccY, SPINE_TRACK_KEYPOINTS, X_BINS, Y_BINS, CONFIG.simccSplitRatio);
    },
  };
  const capture = vi.fn(async (_video: HTMLVideoElement, crop: SpineCrop) => ({ crop, close: () => {} }) as unknown as ImageBitmap);
  const estimator = new SpinePoseEstimator({ createRunner: () => runner, capture, warn: () => {} });
  const video = { videoWidth: W, videoHeight: H, readyState: 4 } as unknown as HTMLVideoElement;
  let clock = 0;
  let rafCallback: FrameRequestCallback | null = null;
  const detector = {
    initialize: async () => {},
    dispose: () => {},
    isReady: () => true,
    setSegmentationEnabled: async () => {},
    processFrame: () => {
      const pose = hinge(scene.body);
      pose.timestamp = clock;
      return pose;
    },
  };
  const motionTracker = {
    startExercise: vi.fn(),
    stopExercise: vi.fn(),
    update: vi.fn(() => null),
    previewPose: vi.fn(() => null),
    getActiveExercise: vi.fn(() => null),
    getJointAngles: vi.fn(() => null),
  } as unknown as MotionTracker;
  const controller = new ExerciseSessionController({
    getVideo: () => video,
    poseDetector: detector,
    motionTracker,
    spinePose: estimator,
    raf: (cb) => {
      rafCallback = cb;
      return 1;
    },
    caf: () => {},
    now: () => clock,
  });
  const frames: ExerciseFramePayload[] = [];
  controller.subscribe((payload) => frames.push(payload));

  async function advance(durationMs: number) {
    const end = clock + durationMs;
    while (clock < end) {
      clock += 67;
      rafCallback?.(clock);
      // Let the estimator's capture and inference promises settle, as a worker would between frames.
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    }
  }
  return { controller, estimator, capture, runner, frames, advance };
}

function overlayLabels(payload: ExerciseFramePayload): string[] {
  const rec = recordingContext(640, 360);
  const labels: string[] = [];
  Object.assign(rec.ctx, { measureText: () => ({ width: 10 }), setLineDash() {}, roundRect() {}, fillText: (text: string) => labels.push(text) });
  drawExerciseFormOverlay(rec.ctx, payload.pose!.landmarks, payload.form!);
  return labels;
}

function lastDeadlift(frames: ExerciseFramePayload[]) {
  const payload = frames[frames.length - 1]!;
  if (payload.form?.kind !== 'deadlift') throw new Error('expected a deadlift result');
  return { payload, form: payload.form, frame: payload.form.frame! };
}

beforeEach(() => {
  resetNeutralSpineProfile();
});

describe('SpinePose through the live exercise session', () => {
  it('detects the bend end to end: the outline is flat, the spine is rounded, and the patient is told', async () => {
    const scene: Scene = { body: { leanDeg: 5, kneeBendDeg: 5 }, chain: {} };
    const { controller, frames, advance } = harness(scene);
    await controller.start(DEADLIFT);
    await advance(1000);
    expect(lastDeadlift(frames).frame.spineSource).toBe('spinepose');
    expect(lastDeadlift(frames).frame.calibration).toBe('ready');

    scene.body = { leanDeg: 55, kneeBendDeg: 30 };
    await advance(1000);
    const flat = lastDeadlift(frames);
    expect(flat.form.faults).toEqual([]);
    expect(flat.frame.backCheck).toBe('judged');
    expect(overlayLabels(flat.payload).some((text) => /^Spine bend -?\d+°$/.test(text))).toBe(true);

    scene.chain = { bulge: 0.1 };
    await advance(2000);
    const rounded = lastDeadlift(frames);
    expect(rounded.form.faults.map((fault) => fault.code)).toEqual(['possible_combined_rounding']);
    expect(rounded.form.faults[0]!.sustained).toBe(true);
    expect(overlayLabels(rounded.payload)).toContain('Possible upper- and lower-back rounding');
    controller.stop();
  });

  it('keeps the decode accurate through the real crop: lumbar and upper-back readings survive the round trip', async () => {
    const scene: Scene = { body: { leanDeg: 60, kneeBendDeg: 30 }, chain: { bulge: 0.1 } };
    const { controller, frames, advance } = harness(scene);
    await controller.start(DEADLIFT);
    await advance(700);
    const { frame } = lastDeadlift(frames);
    // One SimCC bin is half an input pixel: on a 110 px torso that stays well under the 3% threshold.
    expect(frame.lumbar.sagitta!).toBeCloseTo(0.1, 1);
    expect(frame.thoracic.sagitta!).toBeCloseTo(0.1, 1);
    controller.stop();
  });

  it('falls back to the outline when the model breaks mid-session, and the session carries on', async () => {
    const scene: Scene = { body: { leanDeg: 5, kneeBendDeg: 5 }, chain: {} };
    const { controller, estimator, frames, advance } = harness(scene);
    await controller.start(DEADLIFT);
    await advance(800);
    expect(lastDeadlift(frames).frame.spineSource).toBe('spinepose');
    scene.modelError = new Error('webgpu device lost');
    await advance(CONFIG.chain.holdMs + 1500);
    expect(estimator.getStatus()).toBe('failed');
    expect(lastDeadlift(frames).frame.spineSource).toBe('outline');
    expect(frames[frames.length - 1]!.pose).not.toBeNull();
    controller.stop();
  });

  it('does not run the model for exercises that do not check the back', async () => {
    const scene: Scene = { body: { leanDeg: 5, kneeBendDeg: 5 }, chain: {} };
    const { controller, capture, estimator, frames, advance } = harness(scene);
    await controller.start(SQUAT);
    await advance(500);
    expect(capture).not.toHaveBeenCalled();
    expect(estimator.getStatus()).toBe('idle');
    expect(frames[frames.length - 1]!.pose?.spine).toBeUndefined();
    controller.stop();
  });

  it('stops capturing when the session stops, and picks up again on the next set', async () => {
    const scene: Scene = { body: { leanDeg: 5, kneeBendDeg: 5 }, chain: {} };
    const { controller, capture, advance } = harness(scene);
    await controller.start(DEADLIFT);
    await advance(400);
    const during = capture.mock.calls.length;
    expect(during).toBeGreaterThan(0);
    controller.stop();
    await advance(400);
    expect(capture.mock.calls.length).toBe(during);
    await controller.start(DEADLIFT);
    await advance(400);
    expect(capture.mock.calls.length).toBeGreaterThan(during);
    controller.stop();
  });

  it('survives an estimator that throws, without losing the pose or the reps', async () => {
    const scene: Scene = { body: { leanDeg: 55, kneeBendDeg: 30 }, chain: {} };
    const { controller, estimator, frames, advance } = harness(scene);
    vi.spyOn(estimator, 'update').mockImplementation(() => {
      throw new Error('boom');
    });
    await controller.start(DEADLIFT);
    await advance(300);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[frames.length - 1]!.pose).not.toBeNull();
    expect(lastDeadlift(frames).frame.spineSource).toBe('outline');
    controller.stop();
  });
});
