function readRotationDebugFlag(): boolean {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  const env = meta.env;
  if (!env) return false;
  if (env.PROD === true || env.MODE === 'production') return false;
  const flag = env.VITE_VISION_DEBUG_ROTATION ?? env.VISION_DEBUG_ROTATION;
  return flag === true || flag === 'true' || flag === '1';
}

function readExerciseDiagnosticFlag(): boolean {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  const env = meta.env;
  if (!env) return false;
  if (env.PROD === true || env.MODE === 'production') return false;
  const flag = env.VITE_EXERCISE_DIAGNOSTIC ?? env.EXERCISE_DIAGNOSTIC;
  return flag === true || flag === 'true' || flag === '1';
}

export const VISION_CONFIG = {
  capture: {
    targetImageCount: 36,
    minimumImageCount: 30,
    maximumImageCount: 40,
    captureAngleInterval: 10,
    captureAngleTolerance: 4,
  },
  timedCapture: {
    durationMs: 8000,
    frameIntervalMs: 100,
    frameCount: 80,
  },
  quality: {
    minimumPoseConfidence: 0.6,
    minimumOrientationConfidence: 0.6,
    minimumVisibilityConfidence: 0.5,
    bodyCenterMinX: 0.25,
    bodyCenterMaxX: 0.75,
    minimumFrameWidth: 640,
    minimumFrameHeight: 360,
    faceAlignVisibility: 0.45,
  },
  motion: {
    processingFps: 15,
    maximumRotationSpeed: 45,
    minimumRotationSpeed: 8,
    smoothingWindowSize: 8,
    /** Circular EMA on signed frame yaw. 1 = no smoothing. */
    orientationSmoothingAlpha: 0.35,
    orientationHysteresisDeg: 12,
    rotationDeadzoneDeg: 0.4,
    directionConfirmDeg: 25,
    /** Reject a single-frame jump larger than this (MediaPipe glitches ~158–200°). */
    maxOrientationJumpDeg: 45,
    /** Hard cap even after a long dt hitch. Never accept a ~180° teleport. */
    maxUnwrappedStepDeg: 90,
    maxAngularVelocityDegPerSec: 120,
    stablePoseFrames: 8,
    stablePoseMaxSpreadDeg: 12,
  },
  completion: {
    rotationCompleteDeg: 340,
    minimumSectorCoverage: 32,
    minimumAngularSpanDeg: 300,
    holdFrames: 4,
  },
  camera: {
    width: 1280,
    height: 720,
    jpegQuality: 0.92,
    cameraReleaseDelayMs: 250,
    notReadableRetryMs: 300,
  },
  mediapipe: {
    wasmAssetPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
    modelAssetPath:
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    handModelAssetPath:
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    delegate: 'GPU' as const,
    numPoses: 1,
    /** Both hands, so the exercise wireframe can mark every detected finger. */
    numHands: 2,
  },
  jointAngles: {
    /** Minimum MediaPipe visibility for each landmark in a joint triplet. */
    minimumLandmarkVisibility: 0.5,
    /** Reject a single-frame angle change larger than this (MediaPipe glitches). */
    maxAngleJumpDeg: 50,
    /** Minimum segment length (normalized image space or world meters). */
    minimumSegmentLength: 1e-4,
    /** Max ratio of distance to opposite-side anchor before flagging confusion. */
    sideConfusionRatio: 1.35,
  },
  repDetection: {
    /** Multiplier applied to each rule's tolerance for the starting-position window. */
    startToleranceFactor: 1.15,
    /** Minimum elapsed time between counted reps (ms). */
    minTimeBetweenRepsMs: 500,
    /** Grace period subtracted from required hold duration (ms). */
    holdGraceMs: 50,
  },
  debug: {
    rotation: readRotationDebugFlag(),
    exerciseDiagnostic: readExerciseDiagnosticFlag(),
  },
} as const;

export type VisionConfig = typeof VISION_CONFIG;
