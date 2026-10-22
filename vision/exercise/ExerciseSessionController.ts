import { VISION_CONFIG } from '../config';
import { evaluateBodyVisibility } from '../quality/bodyVisibility';
import type { PoseDetectorLike } from '../scanning/ScanController';
import type { Exercise } from './types';
import type { RepDetectionResult, RepPhase } from './types';
import type { MotionTracker } from '../motion/MotionTracker';
import type { PoseResult } from '../types';

export interface ExerciseFrameDiagnostics {
  fps: number;
  cameraWidth: number | null;
  cameraHeight: number | null;
  poseConfidence: number | null;
  bodyVisibilityScore: number | null;
  bodyFullyVisible: boolean;
  jointAngles: Record<
    string,
    { angle?: number; confidence?: number; available: boolean; reason?: string }
  >;
  targets: Record<string, { start: number; required: number; tolerance: number }>;
  phase: RepPhase | null;
  repCount: number;
  targetReps: number;
  trackingEnabled: boolean;
  feedback: string | null;
}

export interface ExerciseFramePayload {
  pose: PoseResult | null;
  result: RepDetectionResult | null;
  timestamp: number;
  diagnostics?: ExerciseFrameDiagnostics;
}

export type ExerciseFrameListener = (payload: ExerciseFramePayload) => void;

export interface ExerciseSessionControllerDeps {
  getVideo: () => HTMLVideoElement | null;
  poseDetector: PoseDetectorLike;
  motionTracker: MotionTracker;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

export class ExerciseSessionController {
  private readonly getVideo: () => HTMLVideoElement | null;
  private readonly poseDetector: PoseDetectorLike;
  private readonly motionTracker: MotionTracker;
  private readonly raf: (cb: FrameRequestCallback) => number;
  private readonly caf: (id: number) => void;
  private readonly now: () => number;
  private readonly listeners = new Set<ExerciseFrameListener>();

  private active = false;
  private trackingEnabled = true;
  private rafId = 0;
  private lastFrameAt = 0;
  private fpsSampleAt = 0;
  private fpsFrameCount = 0;
  private currentFps = 0;
  private readonly diagnosticEnabled = VISION_CONFIG.debug.exerciseDiagnostic;

  constructor(deps: ExerciseSessionControllerDeps) {
    this.getVideo = deps.getVideo;
    this.poseDetector = deps.poseDetector;
    this.motionTracker = deps.motionTracker;
    this.raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
    this.now = deps.now ?? (() => performance.now());
  }

  subscribe(listener: ExerciseFrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isActive(): boolean {
    return this.active;
  }

  setTrackingEnabled(enabled: boolean): void {
    this.trackingEnabled = enabled;
  }

  isTrackingEnabled(): boolean {
    return this.trackingEnabled;
  }

  async start(exercise: Exercise): Promise<void> {
    await this.poseDetector.initialize();
    this.motionTracker.startExercise(exercise);
    this.trackingEnabled = true;
    this.active = true;
    this.lastFrameAt = 0;
    this.loop();
  }

  restartSet(exercise: Exercise): void {
    this.motionTracker.startExercise(exercise);
  }

  stop(): void {
    this.active = false;
    if (this.rafId) {
      this.caf(this.rafId);
      this.rafId = 0;
    }
    this.motionTracker.stopExercise();
  }

  private loop(): void {
    if (!this.active) return;

    const timestamp = this.now();
    const minIntervalMs = 1000 / VISION_CONFIG.motion.processingFps;
    if (timestamp - this.lastFrameAt >= minIntervalMs) {
      this.lastFrameAt = timestamp;
      this.processFrame(timestamp);
    }

    this.rafId = this.raf(() => this.loop());
  }

  private processFrame(timestamp: number): void {
    const video = this.getVideo();
    if (!video || video.readyState < 2 || !this.poseDetector.isReady()) {
      this.emit({ pose: null, result: null, timestamp });
      return;
    }

    this.updateFps(timestamp);

    const pose = this.poseDetector.processFrame(video, timestamp);
    let result: RepDetectionResult | null = null;
    if (pose) {
      result = this.trackingEnabled
        ? this.motionTracker.update(pose)
        : this.motionTracker.previewPose(pose);
    }
    const diagnostics = this.diagnosticEnabled
      ? this.buildDiagnostics(video, pose, result)
      : undefined;
    this.emit({ pose, result, timestamp, diagnostics });
  }

  private updateFps(timestamp: number): void {
    this.fpsFrameCount += 1;
    if (this.fpsSampleAt === 0) {
      this.fpsSampleAt = timestamp;
      return;
    }
    const elapsed = timestamp - this.fpsSampleAt;
    if (elapsed >= 1000) {
      this.currentFps = (this.fpsFrameCount * 1000) / elapsed;
      this.fpsFrameCount = 0;
      this.fpsSampleAt = timestamp;
    }
  }

  private buildDiagnostics(
    video: HTMLVideoElement,
    pose: PoseResult | null,
    result: RepDetectionResult | null,
  ): ExerciseFrameDiagnostics {
    const exercise = this.motionTracker.getActiveExercise();
    const snapshot = this.motionTracker.getJointAngles();
    const visibility = pose ? evaluateBodyVisibility(pose.landmarks) : null;

    const jointAngles: ExerciseFrameDiagnostics['jointAngles'] = {};
    if (snapshot) {
      for (const [joint, reading] of Object.entries(snapshot.joints)) {
        jointAngles[joint] = reading.available
          ? {
              available: true,
              angle: reading.angle,
              confidence: reading.confidence,
            }
          : {
              available: false,
              confidence: reading.confidence,
              reason: reading.reason,
            };
      }
    }

    const targets: ExerciseFrameDiagnostics['targets'] = {};
    for (const rule of exercise?.trackingRules ?? []) {
      targets[rule.joint] = {
        start: rule.startAngle,
        required: rule.requiredAngle,
        tolerance: rule.tolerance,
      };
    }

    return {
      fps: Math.round(this.currentFps * 10) / 10,
      cameraWidth: video.videoWidth || null,
      cameraHeight: video.videoHeight || null,
      poseConfidence: pose?.confidence ?? null,
      bodyVisibilityScore: visibility?.score ?? null,
      bodyFullyVisible: visibility?.visible ?? false,
      jointAngles,
      targets,
      phase: result?.phase ?? null,
      repCount: result?.repCount ?? 0,
      targetReps: result?.targetReps ?? exercise?.recommendedReps ?? 0,
      trackingEnabled: this.trackingEnabled,
      feedback: result?.feedback ?? null,
    };
  }

  private emit(payload: ExerciseFramePayload): void {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }
}
