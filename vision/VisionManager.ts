import { CameraManager } from './camera/CameraManager';
import { FrameCapture } from './camera/frameCapture';
import { VISION_CONFIG } from './config';
import { userMessageForVisionError, VisionError } from './errors';
import type { VisionEventPayload, VisionEventType, VisionListener, VisionSnapshot } from './events';
import { MotionTracker } from './motion/MotionTracker';
import { PoseDetector } from './pose/PoseDetector';
import { ScanController } from './scanning/ScanController';
import type { ScanCaptureMode } from './scanning/scanCaptureMode';
import { targetCaptureCount } from './scanning/scanCaptureMode';
import { TimedCaptureController } from './scanning/TimedCaptureController';
import type {
  CameraDevice,
  JointAnglesSnapshot,
  JointVelocity,
  MotionState,
  PoseResult,
  ScanResult,
  ScanState,
  Vec3,
} from './types';
import { calculateJointAngles } from './pose/jointAngles';
import { PosePreviewController, type PosePreviewListener } from './pose/PosePreviewController';
import { canStartPosePreviewLoop } from './pose/posePreviewGate';
import {
  ExerciseSessionController,
  type ExerciseFrameListener,
} from './exercise/ExerciseSessionController';
import type { Exercise } from './exercise/types';
import type { RepDetectionResult } from './exercise/types';

export class VisionManager {
  private readonly camera = new CameraManager();
  private readonly poseDetector = new PoseDetector();
  private readonly frameCapture = new FrameCapture();
  private readonly motionTracker = new MotionTracker();
  private readonly listeners = new Set<VisionListener>();
  private video: HTMLVideoElement | null = null;
  private lastEvent: VisionEventType | null = null;
  private lastError: VisionSnapshot['error'] = null;
  private readonly scanController: ScanController;
  private readonly timedCaptureController: TimedCaptureController;
  private readonly exerciseSession: ExerciseSessionController;
  private readonly posePreview: PosePreviewController;
  private scanCaptureMode: ScanCaptureMode = 'BODY_360';

  constructor() {
    this.posePreview = new PosePreviewController({
      getVideo: () => this.video,
      poseDetector: this.poseDetector,
    });
    this.exerciseSession = new ExerciseSessionController({
      getVideo: () => this.video,
      poseDetector: this.poseDetector,
      motionTracker: this.motionTracker,
    });
    this.scanController = new ScanController({
      isCameraLive: () => this.camera.isLive(),
      getVideo: () => this.video,
      poseDetector: this.poseDetector,
      captureFrame: (video) => this.frameCapture.capture(video),
      emit: (event) => this.handleScanEvent(event, () => this.scanController.getLastError()),
    });
    this.timedCaptureController = new TimedCaptureController({
      isCameraLive: () => this.camera.isLive(),
      getVideo: () => this.video,
      captureFrame: (video) => this.frameCapture.capture(video),
      emit: (event) => this.handleScanEvent(event, () => this.timedCaptureController.getLastError()),
    });
  }

  setScanCaptureMode(mode: ScanCaptureMode): void {
    this.scanCaptureMode = mode;
  }

  getScanCaptureMode(): ScanCaptureMode {
    return this.scanCaptureMode;
  }

  private handleScanEvent(event: VisionEventType, lastError: () => VisionError | null): void {
    if (event === 'SCAN_ERROR') {
      const err = lastError();
      if (err) this.setError(err);
    }
    this.notify(event);
  }

  private activeScanState(): ScanState {
    if (this.scanCaptureMode === 'TIMED_BURST') {
      return this.timedCaptureController.getSnapshot().scanState;
    }
    return this.scanController.getSnapshot().scanState;
  }

  attachVideo(video: HTMLVideoElement): void {
    this.video = video;
  }

  detachVideo(): void {
    this.video = null;
  }

  detachVideoIfCurrent(video: HTMLVideoElement): void {
    if (this.video === video) this.video = null;
  }

  async listDevices(): Promise<CameraDevice[]> {
    return this.camera.listDevices();
  }

  async startCamera(deviceId?: string | null): Promise<MediaStream> {
    try {
      const stream = await this.camera.retain(deviceId);
      this.lastError = null;
      this.notify('CAMERA_STARTED');
      return stream;
    } catch (err) {
      this.setError(err);
      this.notify('SCAN_ERROR');
      throw err;
    }
  }

  stopCamera(): void {
    this.camera.release();
    this.notify('CAMERA_STOPPED');
  }

  /**
   * Stops vision loops and immediately releases the physical camera device.
   * Prefer this when opening the camera for mirror menu hand-nav after other flows.
   */
  resetCameraSession(): void {
    this.posePreview.stop();
    this.exerciseSession.stop();
    this.stopScan();
    this.camera.stopNow();
    if (this.video) {
      this.video.srcObject = null;
    }
    this.notify('CAMERA_STOPPED');
  }

  async attachStreamToVideo(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
    this.video = video;
    await this.camera.attachToVideo(video, stream);
  }

  getStream(): MediaStream | null {
    return this.camera.getStream();
  }

  async startScan(): Promise<void> {
    this.posePreview.stop();
    this.lastError = null;
    try {
      if (this.scanCaptureMode === 'TIMED_BURST') {
        await this.timedCaptureController.start();
      } else {
        await this.scanController.start();
        if (this.poseDetector.isReady()) this.notify('POSE_READY');
      }
    } catch (err) {
      this.setError(err);
      throw err;
    }
  }

  pauseScan(): void {
    if (this.scanCaptureMode === 'TIMED_BURST') return;
    this.scanController.pause();
  }

  resumeScan(): void {
    if (this.scanCaptureMode === 'TIMED_BURST') return;
    this.scanController.resume();
  }

  stopScan(): void {
    if (this.scanCaptureMode === 'TIMED_BURST') {
      this.timedCaptureController.cancel();
    } else {
      this.scanController.cancel();
    }
    this.notify('SCAN_CANCELLED');
  }

  getScanResult(): ScanResult | null {
    if (this.scanCaptureMode === 'TIMED_BURST') {
      return this.timedCaptureController.getResult();
    }
    return this.scanController.getResult();
  }

  getState(): VisionSnapshot {
    if (this.scanCaptureMode === 'TIMED_BURST') {
      const timed = this.timedCaptureController.getSnapshot();
      return {
        scanCaptureMode: this.scanCaptureMode,
        scanState: timed.scanState,
        guidance: timed.guidance,
        orientation: null,
        rotation: null,
        capturedCount: timed.capturedCount,
        capturedImages: timed.capturedImages,
        targetCount: targetCaptureCount('TIMED_BURST'),
        quality: null,
        cameraReady: this.camera.isLive(),
        poseReady: this.poseDetector.isReady(),
        error: this.lastError,
        lastEvent: this.lastEvent,
        debugRotation: null,
      };
    }

    const scan = this.scanController.getSnapshot();
    return {
      scanCaptureMode: this.scanCaptureMode,
      scanState: scan.scanState,
      guidance: scan.guidance,
      orientation: scan.orientation,
      rotation: scan.rotation,
      capturedCount: scan.capturedCount,
      capturedImages: scan.capturedImages,
      targetCount: VISION_CONFIG.capture.targetImageCount,
      quality: scan.quality,
      cameraReady: this.camera.isLive(),
      poseReady: this.poseDetector.isReady(),
      error: this.lastError,
      lastEvent: this.lastEvent,
      debugRotation: scan.debugRotation,
    };
  }

  subscribe(listener: VisionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getPose(): PoseResult | null {
    return this.motionTracker.getPose();
  }

  getVelocity(): Vec3 | null {
    return this.motionTracker.getVelocity();
  }

  getJointMovement(): JointVelocity[] {
    return this.motionTracker.getJointMovement();
  }

  getMotionState(): MotionState {
    return this.motionTracker.getMotionState();
  }

  getJointAngles(): JointAnglesSnapshot | null {
    return this.motionTracker.getJointAngles();
  }

  /** Calculate joint angles from any pose without updating motion state. */
  calculateJointAngles(pose: PoseResult): JointAnglesSnapshot {
    return calculateJointAngles(pose);
  }

  startExercise(exercise: Exercise): void {
    this.motionTracker.startExercise(exercise);
  }

  stopExercise(): void {
    this.stopExerciseSession();
  }

  updateExercise(pose: PoseResult): RepDetectionResult | null {
    return this.motionTracker.update(pose);
  }

  getLastRepResult(): RepDetectionResult | null {
    return this.motionTracker.getLastRepResult();
  }

  getActiveExercise(): Exercise | null {
    return this.motionTracker.getActiveExercise();
  }

  async startExerciseSession(exercise: Exercise): Promise<void> {
    this.posePreview.stop();
    if (this.exerciseSession.isActive()) {
      this.exerciseSession.stop();
    }
    await this.exerciseSession.start(exercise);
  }

  stopExerciseSession(): void {
    this.exerciseSession.stop();
  }

  restartExerciseSet(exercise: Exercise): void {
    this.exerciseSession.restartSet(exercise);
  }

  setExerciseTrackingEnabled(enabled: boolean): void {
    this.exerciseSession.setTrackingEnabled(enabled);
  }

  isExerciseTrackingEnabled(): boolean {
    return this.exerciseSession.isTrackingEnabled();
  }

  subscribeExerciseFrame(listener: ExerciseFrameListener): () => void {
    return this.exerciseSession.subscribe(listener);
  }

  isExerciseSessionActive(): boolean {
    return this.exerciseSession.isActive();
  }

  canOwnPosePreview(): boolean {
    return canStartPosePreviewLoop(this.exerciseSession.isActive(), this.activeScanState());
  }

  getVideoFrameSize(): { width: number; height: number } | null {
    const video = this.video;
    if (!video?.videoWidth || !video.videoHeight) return null;
    return { width: video.videoWidth, height: video.videoHeight };
  }

  isPosePreviewActive(): boolean {
    return this.posePreview.isActive();
  }

  async startPosePreview(): Promise<void> {
    if (!this.canOwnPosePreview()) return;
    await this.posePreview.start();
    if (this.posePreview.isActive() && this.poseDetector.isReady()) {
      this.notify('POSE_READY');
    }
  }

  stopPosePreview(): void {
    this.posePreview.stop();
  }

  subscribePosePreview(listener: PosePreviewListener): () => void {
    return this.posePreview.subscribe(listener);
  }

  dispose(): void {
    this.posePreview.stop();
    this.exerciseSession.stop();
    this.scanController.dispose();
    this.timedCaptureController.dispose();
    this.poseDetector.dispose();
    this.frameCapture.dispose();
    this.motionTracker.reset();
    this.camera.stopNow();
    this.video = null;
    this.listeners.clear();
    this.lastError = null;
    this.lastEvent = null;
  }

  private setError(err: unknown): void {
    if (err instanceof VisionError) {
      this.lastError = { code: err.code, message: userMessageForVisionError(err.code) };
      return;
    }
    this.lastError = {
      code: 'SCAN_FAILED',
      message: userMessageForVisionError('SCAN_FAILED'),
    };
  }

  private notify(event: VisionEventType): void {
    this.lastEvent = event;
    const payload: VisionEventPayload = { event, state: this.getState() };
    for (const listener of this.listeners) {
      listener(payload);
    }
  }
}

let singleton: VisionManager | null = null;

export function getVisionManager(): VisionManager {
  if (!singleton) singleton = new VisionManager();
  return singleton;
}
