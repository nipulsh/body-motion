import { VISION_CONFIG } from '../config';
import { VisionError } from '../errors';
import type { VisionEventType } from '../events';
import type {
  CapturedFrame,
  CaptureStep,
  CapturedScanImage,
  PoseResult,
  ScanGuidance,
  ScanResult,
  ScanState,
} from '../types';
import { ImageStore } from '../storage/imageStore';

export interface TimedCaptureControllerDeps {
  isCameraLive: () => boolean;
  getVideo: () => HTMLVideoElement | null;
  captureFrame: (video: HTMLVideoElement) => Promise<CapturedFrame | null>;
  emit: (event: VisionEventType) => void;
  now?: () => number;
  /** Optional pose detection on each captured frame (posture measurements for the analysis). */
  detectPose?: (video: HTMLVideoElement) => PoseResult | null;
}

export interface TimedCaptureControllerSnapshot {
  scanState: ScanState;
  guidance: ScanGuidance | null;
  capturedCount: number;
  capturedImages: CapturedScanImage[];
  result: ScanResult | null;
  /** Front / turn right / back to the camera, with the 3-2-1 count between them. Null when not scanning. */
  captureStep: CaptureStep | null;
}

/**
 * Guided capture for the analysis: `framesPerStage` frames facing the camera, then a prompt to turn
 * right, a 3-2-1 count and the same again, then once more with the back to the camera. Each frame
 * carries the stage's angle (0 front, 90 right, 180 back).
 */
export class TimedCaptureController {
  private readonly isCameraLive: () => boolean;
  private readonly getVideo: () => HTMLVideoElement | null;
  private readonly captureFrame: (video: HTMLVideoElement) => Promise<CapturedFrame | null>;
  private readonly emitEvent: (event: VisionEventType) => void;
  private readonly now: () => number;
  private readonly detectPose: ((video: HTMLVideoElement) => PoseResult | null) | null;
  /** Run pose detection on every Nth frame; doubles when a detection eats the frame budget, halves when it is cheap. */
  private poseStride = 1;
  private readonly imageStore = new ImageStore();

  private scanState: ScanState = 'idle';
  private guidance: ScanGuidance | null = null;
  private result: ScanResult | null = null;
  private captureStep: CaptureStep | null = null;
  private startedAt = 0;
  private stageIndex = 0;
  private stageStartedAt = 0;
  /** Frames stored in the current stage. */
  private stageFrames = 0;
  /** Frames stored so far across stages; drives the pose stride. */
  private totalFrames = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private lastError: VisionError | null = null;
  /** Bumped on start, cancel, and dispose so stale async work cannot mutate state. */
  private sessionGeneration = 0;

  constructor(deps: TimedCaptureControllerDeps) {
    this.isCameraLive = deps.isCameraLive;
    this.getVideo = deps.getVideo;
    this.captureFrame = deps.captureFrame;
    this.emitEvent = deps.emit;
    this.now = deps.now ?? (() => performance.now());
    this.detectPose = deps.detectPose ?? null;
  }

  getSnapshot(): TimedCaptureControllerSnapshot {
    return {
      scanState: this.scanState,
      guidance: this.guidance,
      capturedCount: this.imageStore.count(),
      capturedImages: this.imageStore.getAll(),
      result: this.result,
      captureStep: this.captureStep,
    };
  }

  getResult(): ScanResult | null {
    return this.result;
  }

  getLastError(): VisionError | null {
    return this.lastError;
  }

  async start(): Promise<void> {
    if (!this.isCameraLive()) {
      this.fail(new VisionError('SCAN_NOT_READY', 'Camera is not live.'));
      throw new VisionError('SCAN_NOT_READY', 'Camera is not live.');
    }
    if (!this.getVideo()) {
      this.fail(new VisionError('VIDEO_NOT_ATTACHED', 'No video element attached.'));
      throw new VisionError('VIDEO_NOT_ATTACHED', 'No video element attached.');
    }

    this.invalidateSession();
    this.resetSession();
    const generation = this.sessionGeneration;

    this.scanState = 'preparing';
    this.setGuidance('READY');
    this.emitEvent('SCAN_STARTED');
    this.scanState = 'scanning';
    this.setGuidance('READY');
    this.startedAt = this.now();
    this.beginStage(generation);
  }

  cancel(): void {
    this.invalidateSession();
    if (this.scanState === 'completed' || this.scanState === 'error') {
      this.resetSession();
      this.scanState = 'idle';
      return;
    }
    if (this.scanState === 'idle' || this.scanState === 'cancelled') return;
    this.scanState = 'cancelled';
    this.captureStep = null;
    this.emitEvent('SCAN_CANCELLED');
  }

  dispose(): void {
    this.invalidateSession();
    this.imageStore.clear();
    this.resetSession();
    this.scanState = 'idle';
  }

  private invalidateSession(): void {
    this.sessionGeneration += 1;
    this.clearTimer();
  }

  private isActiveSession(generation: number): boolean {
    return generation === this.sessionGeneration && this.scanState === 'scanning';
  }

  private stage() {
    return VISION_CONFIG.timedCapture.stages[this.stageIndex]!;
  }

  private setStep(step: CaptureStep): void {
    this.captureStep = step;
    this.emitEvent('SCAN_PROGRESS');
  }

  private stageDeadline(): number {
    const { framesPerStage, frameIntervalMs, stageSlackMs } = VISION_CONFIG.timedCapture;
    return this.stageStartedAt + framesPerStage * frameIntervalMs + stageSlackMs;
  }

  private beginStage(generation: number): void {
    if (!this.isActiveSession(generation)) return;
    this.stageStartedAt = this.now();
    this.stageFrames = 0;
    this.setStep({ stage: this.stage().id, phase: 'capture', count: null });
    this.scheduleNextFrame(generation);
  }

  private scheduleNextFrame(generation: number): void {
    const { framesPerStage, frameIntervalMs } = VISION_CONFIG.timedCapture;
    if (!this.isActiveSession(generation)) return;

    if (this.stageFrames >= framesPerStage) {
      this.finishStage(generation);
      return;
    }
    if (this.now() >= this.stageDeadline()) {
      this.failShort();
      return;
    }

    const targetAt = this.stageStartedAt + this.stageFrames * frameIntervalMs;
    const delay = Math.max(0, targetAt - this.now());

    this.timerId = setTimeout(() => {
      void this.captureScheduledFrame(generation);
    }, delay);
  }

  private async captureScheduledFrame(generation: number): Promise<void> {
    if (!this.isActiveSession(generation)) return;
    if (this.now() >= this.stageDeadline()) {
      this.failShort();
      return;
    }

    const video = this.getVideo();
    if (!video) {
      this.fail(new VisionError('VIDEO_NOT_ATTACHED', 'No video element attached.'));
      return;
    }

    const frameIndex = this.totalFrames;
    const frame = await this.captureFrame(video);
    if (!this.isActiveSession(generation)) return;

    if (!frame) {
      if (this.now() >= this.stageDeadline()) {
        this.failShort();
        return;
      }
      this.scheduleRetryFrame(generation);
      return;
    }

    const pose = this.maybeDetectPose(video, frameIndex);
    this.imageStore.add({
      blob: frame.blob,
      angleDeg: this.stage().angleDeg,
      timestamp: Math.round(this.now()),
      quality: 1,
      ...(pose ? { pose } : {}),
    });
    this.stageFrames += 1;
    this.totalFrames += 1;
    this.emitEvent('IMAGE_CAPTURED');
    this.emitEvent('SCAN_PROGRESS');
    if (!this.isActiveSession(generation)) return;

    this.scheduleNextFrame(generation);
  }

  /** The stage has its frames: complete after the last one, otherwise ask for the next turn. */
  private finishStage(generation: number): void {
    if (!this.isActiveSession(generation)) return;
    if (this.stageIndex >= VISION_CONFIG.timedCapture.stages.length - 1) {
      this.complete();
      return;
    }
    this.stageIndex += 1;
    this.setStep({ stage: this.stage().id, phase: 'turn', count: null });
    this.timerId = setTimeout(() => {
      this.countdown(generation, VISION_CONFIG.timedCapture.countdownFrom);
    }, VISION_CONFIG.timedCapture.turnPromptMs);
  }

  private countdown(generation: number, count: number): void {
    if (!this.isActiveSession(generation)) return;
    if (count <= 0) {
      this.beginStage(generation);
      return;
    }
    this.setStep({ stage: this.stage().id, phase: 'count', count });
    this.timerId = setTimeout(() => {
      this.countdown(generation, count - 1);
    }, VISION_CONFIG.timedCapture.countdownStepMs);
  }

  /**
   * Pose is optional here (posture measurements), the burst's frame rate is not. Detection runs
   * synchronously on the main thread, so on a slow device it is thinned out instead of letting
   * the burst miss its frame count.
   */
  private maybeDetectPose(video: HTMLVideoElement, frameIndex: number): PoseResult | null {
    if (!this.detectPose || frameIndex % this.poseStride !== 0) return null;
    const started = this.now();
    let pose: PoseResult | null = null;
    try {
      pose = this.detectPose(video);
    } catch {
      pose = null;
    }
    const budget = VISION_CONFIG.timedCapture.frameIntervalMs * VISION_CONFIG.timedCapture.poseBudgetFraction;
    const took = this.now() - started;
    if (took > budget) {
      this.poseStride = Math.min(VISION_CONFIG.timedCapture.maxPoseStride, this.poseStride * 2);
    } else if (took <= budget / 2) {
      // Detection got fast again (the first passes warm up the GPU): sample more frames.
      // Halving only below half the budget leaves a dead band, so the stride does not oscillate.
      this.poseStride = Math.max(1, this.poseStride / 2);
    }
    return pose;
  }

  /** Retry the current frame without stacking parallel capture loops. */
  private scheduleRetryFrame(generation: number): void {
    if (!this.isActiveSession(generation)) return;
    const remaining = this.stageDeadline() - this.now();
    if (remaining <= 0) {
      this.failShort();
      return;
    }
    const delay = Math.max(1, Math.min(VISION_CONFIG.timedCapture.frameIntervalMs, remaining));
    this.timerId = setTimeout(() => {
      void this.captureScheduledFrame(generation);
    }, delay);
  }

  private failShort(): void {
    if (this.scanState !== 'scanning') return;
    const { frameCount } = VISION_CONFIG.timedCapture;
    this.fail(
      new VisionError(
        'SCAN_FAILED',
        `Timed capture produced ${this.imageStore.count()} frames; expected ${frameCount}.`,
      ),
    );
  }

  private complete(): void {
    if (this.scanState !== 'scanning') return;
    this.clearTimer();
    const { frameCount } = VISION_CONFIG.timedCapture;
    const count = this.imageStore.count();
    if (count < frameCount) {
      this.failShort();
      return;
    }

    const completedAt = this.now();
    this.captureStep = null;
    this.result = {
      images: this.imageStore.getAll(),
      imageCount: count,
      rotationCompleted: false,
      durationMs: Math.max(0, completedAt - this.startedAt),
      averageQuality: this.imageStore.averageQuality(),
      startedAt: this.startedAt,
      completedAt,
    };
    this.scanState = 'completed';
    this.setGuidance('SCAN_COMPLETE');
    this.emitEvent('SCAN_COMPLETED');
  }

  private fail(error: VisionError): void {
    this.clearTimer();
    this.lastError = error;
    this.captureStep = null;
    this.scanState = 'error';
    this.emitEvent('SCAN_ERROR');
  }

  private setGuidance(next: ScanGuidance): void {
    if (this.guidance === next) return;
    this.guidance = next;
    this.emitEvent('GUIDANCE');
  }

  private clearTimer(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private resetSession(): void {
    this.clearTimer();
    this.imageStore.clear();
    this.result = null;
    this.guidance = null;
    this.captureStep = null;
    this.startedAt = 0;
    this.stageIndex = 0;
    this.stageStartedAt = 0;
    this.stageFrames = 0;
    this.totalFrames = 0;
    this.lastError = null;
    this.poseStride = 1;
  }
}
