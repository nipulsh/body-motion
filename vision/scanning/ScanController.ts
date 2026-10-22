import { OrientationEstimator } from '../orientation/OrientationEstimator';
import type { OrientationEstimatorLike } from '../orientation/OrientationEstimator';
import { PoseProcessor } from '../pose/PoseProcessor';
import { evaluateBodyVisibility } from '../quality/bodyVisibility';
import { MovementQualityTracker } from '../quality/movementQuality';
import { evaluateScanQuality } from '../quality/scanQuality';
import { VISION_CONFIG } from '../config';
import { VisionError } from '../errors';
import type { VisionEventType } from '../events';
import { shortestAngleDiff } from '../math/angles';
import type {
  CapturedFrame,
  CapturedScanImage,
  OrientationResult,
  PoseResult,
  RotationDebugInfo,
  RotationState,
  ScanGuidance,
  ScanQuality,
  ScanResult,
  ScanState,
} from '../types';
import { CaptureStrategy } from './captureStrategy';
import { RotationTracker } from './RotationTracker';
import { ImageStore } from '../storage/imageStore';

export interface PoseDetectorLike {
  initialize(): Promise<void>;
  processFrame(video: HTMLVideoElement, timestamp: number): PoseResult | null;
  dispose(): void;
  isReady(): boolean;
}

export interface ScanControllerDeps {
  isCameraLive: () => boolean;
  getVideo: () => HTMLVideoElement | null;
  poseDetector: PoseDetectorLike;
  captureFrame: (video: HTMLVideoElement) => Promise<CapturedFrame | null>;
  emit: (event: VisionEventType) => void;
  orientationEstimator?: OrientationEstimatorLike;
  rotationTracker?: RotationTracker;
  captureStrategy?: CaptureStrategy;
  imageStore?: ImageStore;
  poseProcessor?: PoseProcessor;
  movementTracker?: MovementQualityTracker;
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  runLoop?: boolean;
}

export interface ScanControllerSnapshot {
  scanState: ScanState;
  guidance: ScanGuidance | null;
  orientation: OrientationResult | null;
  rotation: RotationState | null;
  capturedCount: number;
  capturedImages: CapturedScanImage[];
  quality: ScanQuality | null;
  result: ScanResult | null;
  debugRotation: RotationDebugInfo | null;
}

export class ScanController {
  private readonly poseDetector: PoseDetectorLike;
  private readonly poseProcessor: PoseProcessor;
  private readonly orientationEstimator: OrientationEstimatorLike;
  private readonly rotationTracker: RotationTracker;
  private readonly captureStrategy: CaptureStrategy;
  private readonly imageStore: ImageStore;
  private readonly movementTracker: MovementQualityTracker;
  private readonly isCameraLive: () => boolean;
  private readonly getVideo: () => HTMLVideoElement | null;
  private readonly captureFrame: (video: HTMLVideoElement) => Promise<CapturedFrame | null>;
  private readonly emitEvent: (event: VisionEventType) => void;
  private readonly now: () => number;
  private readonly raf: (cb: FrameRequestCallback) => number;
  private readonly caf: (id: number) => void;
  private readonly runLoop: boolean;

  private scanState: ScanState = 'idle';
  private guidance: ScanGuidance | null = null;
  private orientation: OrientationResult | null = null;
  private quality: ScanQuality | null = null;
  private result: ScanResult | null = null;
  private startedAt = 0;
  private rafId = 0;
  private lastProcessAt = 0;
  private lastVideoTime = -1;
  private capturing = false;
  private announcedFirstCapture = false;
  private announcedHalfway = false;
  private loopRunning = false;
  private lastError: VisionError | null = null;
  private stablePoseFrames = 0;
  private lastStableYaw: number | null = null;
  private completionHold = 0;

  constructor(deps: ScanControllerDeps) {
    this.isCameraLive = deps.isCameraLive;
    this.getVideo = deps.getVideo;
    this.poseDetector = deps.poseDetector;
    this.captureFrame = deps.captureFrame;
    this.emitEvent = deps.emit;
    this.orientationEstimator = deps.orientationEstimator ?? new OrientationEstimator();
    this.rotationTracker = deps.rotationTracker ?? new RotationTracker();
    this.captureStrategy = deps.captureStrategy ?? new CaptureStrategy();
    this.imageStore = deps.imageStore ?? new ImageStore();
    this.poseProcessor = deps.poseProcessor ?? new PoseProcessor();
    this.movementTracker = deps.movementTracker ?? new MovementQualityTracker();
    this.now = deps.now ?? (() => performance.now());
    this.raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
    this.runLoop = deps.runLoop ?? true;
  }

  getSnapshot(): ScanControllerSnapshot {
    return {
      scanState: this.scanState,
      guidance: this.guidance,
      orientation: this.orientation,
      rotation: this.rotationTracker.getState(),
      capturedCount: this.imageStore.count(),
      capturedImages: this.imageStore.getAll(),
      quality: this.quality,
      result: this.result,
      debugRotation: VISION_CONFIG.debug.rotation ? this.rotationTracker.getDebug() : null,
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

    this.resetSession();
    this.scanState = 'preparing';
    this.setGuidance('POSITION_BODY');
    this.emitEvent('SCAN_STARTED');

    try {
      await this.poseDetector.initialize();
    } catch (err) {
      const error =
        err instanceof VisionError
          ? err
          : new VisionError('POSE_INIT_FAILED', 'Failed to initialize pose tracking.', err);
      this.fail(error);
      throw error;
    }

    this.startedAt = this.now();
    if (this.runLoop) this.startLoop();
  }

  pause(): void {
    if (this.scanState !== 'scanning') return;
    this.scanState = 'paused';
    this.emitEvent('SCAN_PAUSED');
  }

  resume(): void {
    if (this.scanState !== 'paused') return;
    this.scanState = 'scanning';
    this.emitEvent('SCAN_RESUMED');
  }

  cancel(): void {
    if (this.scanState === 'idle' || this.scanState === 'cancelled') {
      return;
    }
    this.stopLoop();
    // A finished scan must not linger on the singleton manager. Otherwise the
    // next visit to ScanningScreen sees `completed` and skips a new capture.
    if (this.scanState === 'completed' || this.scanState === 'error') {
      this.resetSession();
      this.scanState = 'idle';
      return;
    }
    this.scanState = 'cancelled';
    this.emitEvent('SCAN_CANCELLED');
  }

  dispose(): void {
    this.stopLoop();
    this.imageStore.clear();
    this.resetSession();
    this.scanState = 'idle';
  }

  async processPoseSample(
    pose: PoseResult | null,
    timestamp: number,
    frameSize: { width: number; height: number },
    capture: () => Promise<CapturedFrame | null>,
  ): Promise<void> {
    if (
      this.scanState === 'idle' ||
      this.scanState === 'completed' ||
      this.scanState === 'cancelled' ||
      this.scanState === 'error' ||
      this.scanState === 'paused'
    ) {
      return;
    }

    if (!pose) {
      if (this.scanState === 'scanning') this.setGuidance('BODY_NOT_VISIBLE');
      return;
    }

    const metrics = this.poseProcessor.process(pose);
    const visibility = evaluateBodyVisibility(pose.landmarks);
    const orientation = this.orientationEstimator.update(pose, metrics);
    this.orientation = orientation;
    this.rotationTracker.update(orientation.yawDeg, {
      timestampMs: timestamp,
      orientationConfidence: orientation.confidence,
      poseConfidence: pose.confidence,
    });
    const rotation = this.rotationTracker.getState();
    const movement = this.movementTracker.update(rotation.unwrappedAngle, timestamp);
    const quality = evaluateScanQuality({
      visibility,
      poseConfidence: pose.confidence,
      orientationConfidence: orientation.confidence,
      movement,
      bodyCenterX: metrics.torsoCenter.x,
      frameWidth: frameSize.width,
      frameHeight: frameSize.height,
    });
    this.quality = quality;
    this.emitEvent('QUALITY');

    if (this.scanState === 'preparing') {
      if (visibility.visible) {
        this.scanState = 'ready';
        this.setGuidance('READY');
        this.emitEvent('SCAN_READY');
      } else {
        this.setGuidance('POSITION_BODY');
      }
      this.emitEvent('SCAN_PROGRESS');
      return;
    }

    if (this.scanState === 'ready') {
      this.awaitScanStart(orientation, visibility.visible);
      this.emitEvent('SCAN_PROGRESS');
      return;
    }

    if (this.scanState !== 'scanning') return;

    this.updateScanningGuidance(quality);

    const sector = this.captureStrategy.shouldCapture(
      rotation.cumulativeRotation,
      quality.usable,
    );
    if (sector !== null && !this.capturing) {
      this.capturing = true;
      try {
        const frame = await capture();
        if (frame && this.scanState === 'scanning') {
          this.captureStrategy.markCaptured(sector);
          this.imageStore.add({
            blob: frame.blob,
            angleDeg: sector,
            timestamp: frame.timestamp,
            quality: quality.poseConfidence,
          });
          this.emitEvent('IMAGE_CAPTURED');
          if (!this.announcedFirstCapture) {
            this.announcedFirstCapture = true;
            this.setGuidance('TURN_LEFT');
          }
        }
      } finally {
        this.capturing = false;
      }
    }

    this.emitEvent('SCAN_PROGRESS');
    this.maybeComplete();
  }

  private updateScanningGuidance(quality: ScanQuality): void {
    if (!quality.visibility.visible) {
      this.setGuidance('BODY_NOT_VISIBLE');
      return;
    }
    if (quality.movement.tooFast) {
      this.setGuidance('SLOW_DOWN');
      return;
    }
    const progress = this.rotationTracker.getState().rotationProgress;
    if (!this.announcedHalfway && (progress >= 0.5 || this.imageStore.count() >= 18)) {
      this.announcedHalfway = true;
      this.setGuidance('KEEP_TURNING');
      return;
    }
    if (this.announcedFirstCapture) {
      this.setGuidance(this.announcedHalfway ? 'KEEP_TURNING' : 'TURN_LEFT');
    }
  }

  private maybeComplete(): boolean {
    const count = this.imageStore.count();
    const rotation = this.rotationTracker.getState();
    const { capture, completion } = VISION_CONFIG;

    if (rotation.completed) this.completionHold += 1;
    else this.completionHold = 0;

    const rotatedSteadily =
      rotation.completed && this.completionHold >= completion.holdFrames;
    const hitCap = count >= capture.maximumImageCount;
    const fullTurn = rotatedSteadily && count >= capture.minimumImageCount;
    const targetCoverage =
      count >= capture.targetImageCount &&
      Math.abs(rotation.cumulativeRotation) >= completion.minimumAngularSpanDeg &&
      (this.captureStrategy.uniqueCount() >= completion.minimumSectorCoverage ||
        this.captureStrategy.angularSpan() >= completion.minimumAngularSpanDeg);

    if (!hitCap && !fullTurn && !targetCoverage) return false;
    this.complete();
    return true;
  }

  private awaitScanStart(
    orientation: OrientationResult,
    bodyVisible: boolean,
  ): void {
    if (!bodyVisible || orientation.confidence < VISION_CONFIG.quality.minimumOrientationConfidence) {
      this.stablePoseFrames = 0;
      this.lastStableYaw = null;
      this.setGuidance('POSITION_BODY');
      return;
    }

    if (
      this.lastStableYaw !== null &&
      shortestAngleDiff(orientation.yawDeg, this.lastStableYaw) <=
        VISION_CONFIG.motion.stablePoseMaxSpreadDeg
    ) {
      this.stablePoseFrames += 1;
    } else {
      this.stablePoseFrames = 1;
      this.lastStableYaw = orientation.yawDeg;
    }

    if (this.stablePoseFrames < VISION_CONFIG.motion.stablePoseFrames) {
      this.setGuidance('READY');
      return;
    }

    this.rotationTracker.captureScanStart();
    this.scanState = 'scanning';
    this.setGuidance('TURN_LEFT');
  }

  private complete(): void {
    this.stopLoop();
    const completedAt = this.now();
    this.result = {
      images: this.imageStore.getAll(),
      imageCount: this.imageStore.count(),
      rotationCompleted: this.rotationTracker.isCompleted(),
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
    this.stopLoop();
    this.lastError = error;
    this.scanState = 'error';
    this.emitEvent('SCAN_ERROR');
  }

  private setGuidance(next: ScanGuidance): void {
    if (this.guidance === next) return;
    this.guidance = next;
    this.emitEvent('GUIDANCE');
  }

  private resetSession(): void {
    this.stopLoop();
    this.orientationEstimator.reset();
    this.rotationTracker.reset();
    this.captureStrategy.reset();
    this.imageStore.clear();
    this.movementTracker.reset();
    this.orientation = null;
    this.quality = null;
    this.result = null;
    this.guidance = null;
    this.lastProcessAt = 0;
    this.lastVideoTime = -1;
    this.capturing = false;
    this.announcedFirstCapture = false;
    this.announcedHalfway = false;
    this.stablePoseFrames = 0;
    this.lastStableYaw = null;
    this.completionHold = 0;
    this.startedAt = 0;
    this.lastError = null;
  }

  private startLoop(): void {
    this.loopRunning = true;
    const tick = () => {
      if (!this.loopRunning) return;
      this.rafId = this.raf(() => {
        void this.loopTick().finally(() => {
          if (this.loopRunning) tick();
        });
      });
    };
    tick();
  }

  private stopLoop(): void {
    this.loopRunning = false;
    if (this.rafId) {
      this.caf(this.rafId);
      this.rafId = 0;
    }
  }

  private async loopTick(): Promise<void> {
    if (
      this.scanState === 'completed' ||
      this.scanState === 'cancelled' ||
      this.scanState === 'error' ||
      this.scanState === 'idle'
    ) {
      return;
    }

    try {
      const now = this.now();
      const minInterval = 1000 / VISION_CONFIG.motion.processingFps;
      if (now - this.lastProcessAt < minInterval) return;
      this.lastProcessAt = now;

      const video = this.getVideo();
      if (!video || video.readyState < 2) return;
      if (video.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = video.currentTime;

      const pose = this.poseDetector.processFrame(video, now);
      await this.processPoseSample(pose, now, {
        width: video.videoWidth,
        height: video.videoHeight,
      }, () => this.captureFrame(video));
    } catch (err) {
      const error =
        err instanceof VisionError
          ? err
          : new VisionError('SCAN_FAILED', 'Scan processing failed.', err);
      this.fail(error);
    }
  }
}
