import { VISION_CONFIG } from '../config';
import type { PoseResult, PoseSpine } from '../types';
import { keypointsToFrame, spineCropFromLandmarks, type SpineCrop } from './spinePoseCodec';
import { SPINE_CHAIN_IDS, type SpineKeypoints } from './spineTrack';

type SpinePoseConfig = typeof VISION_CONFIG.spinePose;

export type SpinePoseStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Runs the model somewhere that does not hold up the camera loop. */
export interface SpinePoseRunner {
  load(): Promise<void>;
  /** Takes ownership of the bitmap. */
  run(frame: ImageBitmap): Promise<SpineKeypoints>;
  dispose(): void;
  backend?(): string | null;
}

export interface SpinePoseEstimatorDeps {
  createRunner: () => SpinePoseRunner;
  capture?: (video: HTMLVideoElement, crop: SpineCrop) => Promise<ImageBitmap | null>;
  warn?: (message: string, error: unknown) => void;
  now?: () => number;
  config?: SpinePoseConfig;
}

function captureCrop(config: SpinePoseConfig) {
  return (video: HTMLVideoElement, crop: SpineCrop): Promise<ImageBitmap | null> =>
    createImageBitmap(
      video,
      Math.round(crop.x),
      Math.round(crop.y),
      Math.max(1, Math.round(crop.width)),
      Math.max(1, Math.round(crop.height)),
      // The same plain bilinear resampling the model's own crop uses. Past the frame edge reads as black.
      { resizeWidth: config.inputWidth, resizeHeight: config.inputHeight, resizeQuality: 'low' },
    );
}

/**
 * Spine keypoints for the current body, off the camera loop. `update` is called once per pose
 * frame and never waits: it starts an inference if none is running and returns the latest result
 * that is still recent. A slow model drops frames and does not queue them. If the model cannot
 * load or keeps failing, this returns null and the back check falls back to the body outline.
 */
export class SpinePoseEstimator {
  private readonly createRunner: () => SpinePoseRunner;
  private readonly capture: (video: HTMLVideoElement, crop: SpineCrop) => Promise<ImageBitmap | null>;
  private readonly warn: (message: string, error: unknown) => void;
  private readonly now: () => number;
  private readonly config: SpinePoseConfig;

  private runner: SpinePoseRunner | null = null;
  private status: SpinePoseStatus = 'idle';
  private enabled = false;
  private inFlight = false;
  private lastStartAt = -Infinity;
  private latest: PoseSpine | null = null;
  private failures = 0;
  private lastInferenceMs: number | null = null;
  /** Bumped when results already on their way no longer apply. */
  private generation = 0;

  constructor(deps: SpinePoseEstimatorDeps) {
    this.config = deps.config ?? VISION_CONFIG.spinePose;
    this.createRunner = deps.createRunner;
    this.capture = deps.capture ?? captureCrop(this.config);
    this.warn = deps.warn ?? ((message, error) => console.warn(message, error));
    this.now = deps.now ?? (() => performance.now());
  }

  getStatus(): SpinePoseStatus {
    return this.status;
  }

  getLastInferenceMs(): number | null {
    return this.lastInferenceMs;
  }

  getBackend(): string | null {
    return this.runner?.backend?.() ?? null;
  }

  /**
   * On: start loading if that has not happened. A load that failed gets another try here, once
   * per set, rather than on every frame. Off: forget results but keep the model, so a rest between
   * sets does not download it again.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.latest = null;
    this.generation += 1;
    this.inFlight = false;
    if (enabled && (this.status === 'idle' || this.status === 'failed')) this.load();
  }

  update(video: HTMLVideoElement, pose: PoseResult, timestamp: number): PoseSpine | null {
    if (!this.enabled || this.status !== 'ready') return null;
    this.maybeStart(video, pose, timestamp);
    const latest = this.latest;
    if (!latest || timestamp - latest.capturedAt > this.config.maxResultAgeMs) return null;
    return latest;
  }

  dispose(): void {
    this.enabled = false;
    this.latest = null;
    this.generation += 1;
    this.inFlight = false;
    this.releaseRunner();
    this.status = 'idle';
  }

  private load(): void {
    this.failures = 0;
    this.status = 'loading';
    let runner: SpinePoseRunner;
    try {
      runner = this.createRunner();
    } catch (error) {
      this.giveUp('Spine model could not start; using the body outline.', error);
      return;
    }
    this.runner = runner;
    runner.load().then(
      () => {
        if (this.runner === runner) this.status = 'ready';
      },
      (error: unknown) => {
        if (this.runner === runner) this.giveUp('Spine model could not load; using the body outline.', error);
      },
    );
  }

  private maybeStart(video: HTMLVideoElement, pose: PoseResult, timestamp: number): void {
    if (this.inFlight || timestamp - this.lastStartAt < this.config.minIntervalMs) return;
    const frameWidth = video.videoWidth;
    const frameHeight = video.videoHeight;
    const crop = spineCropFromLandmarks(pose.landmarks, frameWidth, frameHeight, this.config);
    if (!crop) return;
    this.inFlight = true;
    this.lastStartAt = timestamp;
    void this.infer(video, crop, frameWidth, frameHeight, timestamp, this.generation);
  }

  private async infer(
    video: HTMLVideoElement,
    crop: SpineCrop,
    frameWidth: number,
    frameHeight: number,
    timestamp: number,
    generation: number,
  ): Promise<void> {
    const startedAt = this.now();
    try {
      const frame = await this.capture(video, crop);
      if (generation !== this.generation) {
        frame?.close();
        return;
      }
      if (!frame) {
        this.inFlight = false;
        return;
      }
      const runner = this.runner;
      if (!runner) {
        frame.close();
        return;
      }
      const keypoints = await runner.run(frame);
      if (generation !== this.generation) return;
      const all = keypointsToFrame(keypoints, crop, frameWidth, frameHeight, this.config.inputWidth, this.config.inputHeight);
      const points = SPINE_CHAIN_IDS.map((id) => all[id]);
      if (points.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.score))) {
        throw new Error('Spine model returned coordinates that are not numbers.');
      }
      this.latest = { points: points as NonNullable<(typeof points)[number]>[], capturedAt: timestamp };
      this.lastInferenceMs = this.now() - startedAt;
      this.failures = 0;
      this.inFlight = false;
    } catch (error) {
      if (generation !== this.generation) return;
      this.inFlight = false;
      this.failures += 1;
      if (this.failures >= this.config.maxConsecutiveFailures) {
        this.giveUp('Spine model keeps failing; using the body outline.', error);
      }
    }
  }

  private giveUp(message: string, error: unknown): void {
    this.status = 'failed';
    this.latest = null;
    this.generation += 1;
    this.inFlight = false;
    this.releaseRunner();
    this.warn(message, error);
  }

  private releaseRunner(): void {
    const runner = this.runner;
    this.runner = null;
    try {
      runner?.dispose();
    } catch {
      // Nothing more can be done with a runner that will not shut down.
    }
  }
}
