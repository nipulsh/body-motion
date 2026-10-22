import { VISION_CONFIG } from '../config';
import { VisionError } from '../errors';
import type { VisionEventType } from '../events';
import type { CapturedFrame, CapturedScanImage, ScanGuidance, ScanResult, ScanState } from '../types';
import { ImageStore } from '../storage/imageStore';

export interface TimedCaptureControllerDeps {
  isCameraLive: () => boolean;
  getVideo: () => HTMLVideoElement | null;
  captureFrame: (video: HTMLVideoElement) => Promise<CapturedFrame | null>;
  emit: (event: VisionEventType) => void;
  now?: () => number;
}

export interface TimedCaptureControllerSnapshot {
  scanState: ScanState;
  guidance: ScanGuidance | null;
  capturedCount: number;
  capturedImages: CapturedScanImage[];
  result: ScanResult | null;
}

export class TimedCaptureController {
  private readonly isCameraLive: () => boolean;
  private readonly getVideo: () => HTMLVideoElement | null;
  private readonly captureFrame: (video: HTMLVideoElement) => Promise<CapturedFrame | null>;
  private readonly emitEvent: (event: VisionEventType) => void;
  private readonly now: () => number;
  private readonly imageStore = new ImageStore();

  private scanState: ScanState = 'idle';
  private guidance: ScanGuidance | null = null;
  private result: ScanResult | null = null;
  private startedAt = 0;
  private nextFrameIndex = 0;
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
  }

  getSnapshot(): TimedCaptureControllerSnapshot {
    return {
      scanState: this.scanState,
      guidance: this.guidance,
      capturedCount: this.imageStore.count(),
      capturedImages: this.imageStore.getAll(),
      result: this.result,
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
    this.scheduleNextFrame(generation);
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

  private scheduleNextFrame(generation: number): void {
    const { frameCount, frameIntervalMs, durationMs } = VISION_CONFIG.timedCapture;
    if (!this.isActiveSession(generation)) return;

    const deadline = this.startedAt + durationMs;
    if (this.now() >= deadline) {
      this.complete();
      return;
    }

    if (this.nextFrameIndex >= frameCount) {
      this.complete();
      return;
    }

    const targetAt = this.startedAt + this.nextFrameIndex * frameIntervalMs;
    const delay = Math.max(0, targetAt - this.now());

    this.timerId = setTimeout(() => {
      void this.captureScheduledFrame(deadline, generation);
    }, delay);
  }

  private async captureScheduledFrame(deadline: number, generation: number): Promise<void> {
    if (!this.isActiveSession(generation)) return;
    if (this.now() >= deadline) {
      this.complete();
      return;
    }

    const video = this.getVideo();
    if (!video) {
      this.fail(new VisionError('VIDEO_NOT_ATTACHED', 'No video element attached.'));
      return;
    }

    const frameIndex = this.nextFrameIndex;
    const frame = await this.captureFrame(video);
    if (!this.isActiveSession(generation)) return;

    if (!frame) {
      if (this.now() >= deadline) {
        this.complete();
        return;
      }
      this.scheduleRetryFrame(deadline, generation);
      return;
    }

    this.nextFrameIndex += 1;
    const captureTimestamp = this.startedAt + frameIndex * VISION_CONFIG.timedCapture.frameIntervalMs;
    this.imageStore.add({
      blob: frame.blob,
      angleDeg: frameIndex,
      timestamp: Math.round(captureTimestamp),
      quality: 1,
    });
    this.emitEvent('IMAGE_CAPTURED');
    this.emitEvent('SCAN_PROGRESS');
    if (!this.isActiveSession(generation)) return;

    const { frameCount } = VISION_CONFIG.timedCapture;
    if (this.now() >= deadline || this.imageStore.count() >= frameCount) {
      this.complete();
      return;
    }

    this.scheduleNextFrame(generation);
  }

  /** Retry the current frame index without stacking parallel capture loops. */
  private scheduleRetryFrame(deadline: number, generation: number): void {
    if (!this.isActiveSession(generation)) return;
    const remaining = deadline - this.now();
    if (remaining <= 0) {
      this.complete();
      return;
    }
    const delay = Math.max(1, Math.min(VISION_CONFIG.timedCapture.frameIntervalMs, remaining));
    this.timerId = setTimeout(() => {
      void this.captureScheduledFrame(deadline, generation);
    }, delay);
  }

  private complete(): void {
    if (this.scanState !== 'scanning') return;
    this.clearTimer();
    const { frameCount } = VISION_CONFIG.timedCapture;
    const count = this.imageStore.count();
    if (count < frameCount) {
      this.fail(
        new VisionError(
          'SCAN_FAILED',
          `Timed capture produced ${count} frames; expected ${frameCount}.`,
        ),
      );
      return;
    }

    const completedAt = this.now();
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
    this.startedAt = 0;
    this.nextFrameIndex = 0;
    this.lastError = null;
  }
}
