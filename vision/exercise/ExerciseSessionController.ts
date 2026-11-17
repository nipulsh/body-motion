import { VISION_CONFIG } from '../config';
import { evaluateBodyVisibility } from '../quality/bodyVisibility';
import type { PoseDetectorLike } from '../scanning/ScanController';
import type { Exercise } from './types';
import type { RepDetectionResult, RepPhase } from './types';
import type { MotionTracker } from '../motion/MotionTracker';
import type { SpinePoseEstimator } from '../spine/SpinePoseEstimator';
import type { PoseResult } from '../types';
import type { RangeView } from './angleRangeModels';
import { ExerciseFormMonitor, type ExerciseFormResult } from './exerciseForm';

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
  /** Present during a deadlift. Camera orientation and landmark visibility are separate. */
  deadlift?: {
    cameraSideOn: boolean;
    shoulderToTorso: number | null;
    landmarksVisible: boolean;
    validation: string;
    trunkLeanDeg: number;
    backAngleDeg: number;
    spineAngleDeg: number | null;
    landmarkVisibility: Record<string, number>;
    spinePointCount: number;
    spineStatus: string;
    spineConfidence: number;
    upperBackCurvature: number | null;
    upperBackConfidence: number;
    midBackCurvature: number | null;
    lowerBackCurvature: number | null;
    lowerBackConfidence: number;
    overallCurvature: number | null;
    hipHingeDeg: number | null;
    segmentationConfidence: number;
    spineSource: string;
    spineRejection: string | null;
    spineBendDeltaDeg: number | null;
    /** T8–T3–C7 turn, and how far past standing it is. */
    upperBackLineDeg: number | null;
    upperBackLineDeltaDeg: number | null;
    upperBackLineBent: boolean;
    pelvicTiltDeg: number | null;
    pelvicTiltDeltaDeg: number | null;
    trunkInclination3dDeg: number | null;
    bodyYawDeg: number | null;
    sagittalStretch: number;
    poseModel: string | null;
    spineModelStatus: string;
    spineModelBackend: string | null;
    spineInferenceMs: number | null;
  };
}

export interface ExerciseFramePayload {
  pose: PoseResult | null;
  result: RepDetectionResult | null;
  timestamp: number;
  diagnostics?: ExerciseFrameDiagnostics;
  /** Set for exercises with a `formCheck`, while tracking is enabled. */
  form?: ExerciseFormResult | null;
}

export type ExerciseFrameListener = (payload: ExerciseFramePayload) => void;

/** The deadlift back check reads the body outline; other exercises skip the extra GPU read. */
function needsSilhouette(exercise: Exercise): boolean {
  return exercise.formCheck === 'deadlift';
}

/** The same check reads the spine's keypoints. The outline stays on as its fallback. */
function needsSpineKeypoints(exercise: Exercise): boolean {
  return exercise.formCheck === 'deadlift';
}

/** The deadlift back check runs on MediaPipe's heavy model, for steadier landmarks and world landmarks. */
function poseModelFor(exercise: Exercise): 'full' | 'heavy' {
  return exercise.formCheck === 'deadlift' && VISION_CONFIG.mediapipe.heavyModelForDeadlift ? 'heavy' : 'full';
}

export type SpinePoseEstimatorLike = Pick<
  SpinePoseEstimator,
  'setEnabled' | 'update' | 'getStatus' | 'getLastInferenceMs' | 'getBackend'
>;

export interface ExerciseSessionControllerDeps {
  getVideo: () => HTMLVideoElement | null;
  poseDetector: PoseDetectorLike;
  motionTracker: MotionTracker;
  /** Optional: without it the deadlift back check reads the body outline. */
  spinePose?: SpinePoseEstimatorLike;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

export class ExerciseSessionController {
  private readonly getVideo: () => HTMLVideoElement | null;
  private readonly poseDetector: PoseDetectorLike;
  private readonly motionTracker: MotionTracker;
  private readonly spinePose: SpinePoseEstimatorLike | null;
  private spinePoseThrew = false;
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
  private readonly form = new ExerciseFormMonitor();

  constructor(deps: ExerciseSessionControllerDeps) {
    this.getVideo = deps.getVideo;
    this.poseDetector = deps.poseDetector;
    this.motionTracker = deps.motionTracker;
    this.spinePose = deps.spinePose ?? null;
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

  /** Squat and lunge models: the view this set is judged in (see `ExerciseFormMonitor.setRequiredView`). */
  setRequiredFormView(view: RangeView | null): void {
    this.form.setRequiredView(view);
  }

  isTrackingEnabled(): boolean {
    return this.trackingEnabled;
  }

  async start(exercise: Exercise): Promise<void> {
    await this.poseDetector.initialize();
    await this.poseDetector.setSegmentationEnabled?.(needsSilhouette(exercise));
    // Not awaited: the session starts on the current model and moves over once the other has loaded.
    void this.poseDetector.setModelVariant?.(poseModelFor(exercise));
    // Loads in the background: the session does not wait for a download. Until it is ready the
    // back check reads the outline.
    this.spinePose?.setEnabled(needsSpineKeypoints(exercise));
    this.motionTracker.startExercise(exercise);
    this.form.start(exercise);
    this.trackingEnabled = true;
    this.active = true;
    this.lastFrameAt = 0;
    this.loop();
  }

  restartSet(exercise: Exercise): void {
    void this.poseDetector.setSegmentationEnabled?.(needsSilhouette(exercise));
    void this.poseDetector.setModelVariant?.(poseModelFor(exercise));
    this.spinePose?.setEnabled(needsSpineKeypoints(exercise));
    this.motionTracker.startExercise(exercise);
    this.form.restartSet(exercise);
  }

  stop(): void {
    this.active = false;
    if (this.rafId) {
      this.caf(this.rafId);
      this.rafId = 0;
    }
    this.motionTracker.stopExercise();
    void this.poseDetector.setSegmentationEnabled?.(false);
    void this.poseDetector.setModelVariant?.('full');
    this.spinePose?.setEnabled(false);
  }

  /** Attach spine keypoints to the pose. The model is optional: nothing here may stop the session. */
  private attachSpine(video: HTMLVideoElement, pose: PoseResult, timestamp: number): void {
    if (!this.spinePose || !this.trackingEnabled) return;
    try {
      const spine = this.spinePose.update(video, pose, timestamp);
      if (spine) pose.spine = spine;
    } catch (error) {
      if (!this.spinePoseThrew) console.warn('Spine keypoints failed; using the body outline.', error);
      this.spinePoseThrew = true;
    }
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
      this.attachSpine(video, pose, timestamp);
      result = this.trackingEnabled
        ? this.motionTracker.update(pose)
        : this.motionTracker.previewPose(pose);
    }
    const diagnostics = this.diagnosticEnabled
      ? this.buildDiagnostics(video, pose, result)
      : undefined;
    const form = this.updateForm(video, pose, result, timestamp);
    if (form?.kind === 'deadlift' && form.frame) {
      const spine = this.motionTracker.getJointAngles()?.joints.spine;
      const landmarkVisibility: Record<string, number> = {};
      for (const [name, sight] of Object.entries(form.frame.view.landmarks)) {
        if (sight) landmarkVisibility[name] = sight.visibility;
      }
      const curve = form.frame.spineCurve;
      const deadlift = {
        cameraSideOn: form.frame.view.cameraSideOn,
        shoulderToTorso: form.frame.view.shoulderToTorso,
        landmarksVisible: form.frame.view.landmarksVisible,
        validation: form.frame.backCheck,
        trunkLeanDeg: form.frame.trunkLeanDeg,
        backAngleDeg: form.frame.backAngleDeg,
        spineAngleDeg: spine?.available ? spine.angle : null,
        landmarkVisibility,
        spinePointCount: curve.points.length,
        spineStatus: curve.status,
        spineConfidence: curve.confidence,
        upperBackCurvature: curve.upperThoracic.sagitta,
        upperBackConfidence: curve.upperThoracic.confidence,
        midBackCurvature: curve.midThoracic.sagitta,
        lowerBackCurvature: curve.lumbar.sagitta,
        lowerBackConfidence: curve.lumbar.confidence,
        overallCurvature: curve.overall.sagitta,
        hipHingeDeg: curve.hipHingeDeg,
        segmentationConfidence: curve.segmentationConfidence,
        spineSource: form.frame.spineSource,
        spineRejection: form.frame.spineRejection,
        spineBendDeltaDeg: form.frame.spineBendDeltaDeg,
        upperBackLineDeg: form.frame.upperBackLineDeg,
        upperBackLineDeltaDeg: form.frame.upperBackLineDeltaDeg,
        upperBackLineBent: form.frame.upperBackLineBent,
        pelvicTiltDeg: form.frame.pelvicTiltDeg,
        pelvicTiltDeltaDeg: form.frame.pelvicTiltDeltaDeg,
        trunkInclination3dDeg: form.frame.trunkInclination3dDeg,
        bodyYawDeg: form.frame.bodyYawDeg,
        sagittalStretch: form.frame.sagittalStretch,
        poseModel: this.poseDetector.getModelVariant?.() ?? null,
        spineModelStatus: this.spinePose?.getStatus() ?? 'off',
        spineModelBackend: this.spinePose?.getBackend() ?? null,
        spineInferenceMs: this.spinePose?.getLastInferenceMs() ?? null,
      };
      if (diagnostics) diagnostics.deadlift = deadlift;
      if (this.diagnosticEnabled) {
        console.debug('[deadlift]', {
          ...deadlift,
          repPhase: result?.phase ?? null,
          repCount: result?.repCount ?? 0,
          deadliftPhase: form.frame.phase,
        });
      }
    }
    this.emit({ pose, result, timestamp, diagnostics, form });
  }

  private updateForm(
    video: HTMLVideoElement,
    pose: PoseResult | null,
    result: RepDetectionResult | null,
    timestamp: number,
  ): ExerciseFormResult | null {
    const aspect =
      video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : undefined;
    if (!this.trackingEnabled) {
      // Null, except for a squat or lunge model: the app waits for the right view before a set.
      return this.form.observeStanding(pose, timestamp, aspect);
    }
    return this.form.update(pose, timestamp, result?.repCount ?? 0, aspect);
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
