export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  /** Set when the pose runtime reports presence separately from visibility. */
  presence?: number;
}

/**
 * Person mask from the pose model, covering the whole camera frame (not mirrored).
 * Row-major, 0 = background, 255 = person. Width / height matches the frame aspect.
 */
export interface PoseSilhouette {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PoseSpinePoint {
  /** Normalized image coordinates, like a pose landmark. Not mirrored. */
  x: number;
  y: number;
  /** SimCC peak value. Not a probability: it runs above 1 on a clear view. */
  score: number;
}

/** Spine keypoints from the SpinePose model, pelvis to skull. See `spine/spineTrack.ts` for the order. */
export interface PoseSpine {
  points: PoseSpinePoint[];
  /** Timestamp of the video frame these came from. The model runs behind the pose, so it can be older. */
  capturedAt: number;
}

export interface PoseResult {
  landmarks: PoseLandmark[];
  worldLandmarks?: PoseLandmark[];
  confidence: number;
  timestamp: number;
  /** Source frame width / height. Image x and y are normalized to different pixel spans, so angles need it. */
  frameAspect?: number;
  /** Present only while a check that reads the body outline (deadlift back shape) has asked for it. */
  silhouette?: PoseSilhouette;
  /** Present once the spine model has a recent result for a check that asked for it. */
  spine?: PoseSpine;
}

export interface PoseMetrics {
  bodyCenter: Vec3;
  torsoCenter: Vec3;
  shoulderMid: Vec3;
  hipMid: Vec3;
  shoulderWidth: number;
  hipWidth: number;
  torsoOrientationHintDeg: number;
  aabb: BoundingBox;
  visibilityMean: number;
  landmarkConfidenceMean: number;
}

export type FacingDirection =
  | 'front'
  | 'front_right'
  | 'right'
  | 'back_right'
  | 'back'
  | 'back_left'
  | 'left'
  | 'front_left';

export interface OrientationResult {
  /** Signed bounded frame yaw in (-180, 180]. 0 = facing camera. */
  yawDeg: number;
  rawYawDeg: number;
  /** Same heading mapped to [0, 360) for 8-way labels only. */
  normalizedAngle: number;
  direction: FacingDirection;
  confidence: number;
}

export type RotationDirection = 'clockwise' | 'counterclockwise' | 'unknown';

export interface RotationState {
  rawAngle: number;
  unwrappedAngle: number;
  cumulativeRotation: number;
  rotationProgress: number;
  direction: RotationDirection;
  completed: boolean;
  confidence: number;
}

export interface RotationDebugInfo {
  rawAngle: number;
  smoothedAngle: number;
  unwrappedAngle: number;
  cumulativeRotation: number;
  rotationProgress: number;
  direction: RotationDirection;
  poseConfidence: number;
  orientationConfidence: number;
  frameDelta: number;
  previousAngle: number;
  timestamp: number;
}

export type ScanState =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'scanning'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'error';

export type ScanGuidance =
  | 'POSITION_BODY'
  | 'READY'
  | 'TURN_LEFT'
  | 'KEEP_TURNING'
  | 'SLOW_DOWN'
  | 'BODY_NOT_VISIBLE'
  | 'SCAN_COMPLETE';

export type QualityIssue =
  | 'BODY_NOT_VISIBLE'
  | 'LOW_POSE_CONFIDENCE'
  | 'LOW_ORIENTATION_CONFIDENCE'
  | 'TOO_FAST'
  | 'TOO_SLOW'
  | 'NOT_CENTERED'
  | 'FRAME_TOO_SMALL';

export interface BodyVisibility {
  visible: boolean;
  score: number;
  missingLandmarks: string[];
}

export interface MovementQuality {
  speedDegPerSec: number;
  tooFast: boolean;
  tooSlow: boolean;
}

export interface ScanQuality {
  usable: boolean;
  poseConfidence: number;
  orientationConfidence: number;
  visibility: BodyVisibility;
  movement: MovementQuality;
  centered: boolean;
  frameSized: boolean;
  issues: QualityIssue[];
}

export interface CapturedFrame {
  blob: Blob;
  timestamp: number;
  width: number;
  height: number;
}

/** Which view the guided analysis capture is on: facing the camera, turned right, then the back. */
export type CaptureStageId = 'front' | 'right' | 'back';

/**
 * Where the guided capture is: taking frames (`capture`), asking the user to turn (`turn`), or
 * counting down before the next frames (`count`, with `count` = 3, 2, 1). For `turn` and `count`,
 * `stage` is the view that is about to be captured.
 */
export interface CaptureStep {
  stage: CaptureStageId;
  phase: 'capture' | 'turn' | 'count';
  count: number | null;
}

export interface CapturedScanImage {
  blob: Blob;
  angleDeg: number;
  timestamp: number;
  quality: number;
  /** Pose detected on this frame, when available; feeds the objective posture measurements. */
  pose?: PoseResult;
}

export interface ScanResult {
  images: CapturedScanImage[];
  imageCount: number;
  rotationCompleted: boolean;
  durationMs: number;
  averageQuality: number;
  startedAt: number;
  completedAt: number;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface JointVelocity {
  name: string;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
}

import type { RepDetectionResult } from './exercise/types';

export interface MotionState {
  pose: PoseResult | null;
  velocity: Vec3 | null;
  jointMovement: JointVelocity[];
  tracking: boolean;
  jointAngles: JointAnglesSnapshot | null;
  exerciseActive?: boolean;
  repDetection?: RepDetectionResult | null;
}

/** Aligns with server exercise `trackingRules` joint names (snake_case). */
export type TrackableJointName =
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee'
  | 'left_ankle'
  | 'right_ankle'
  | 'neck'
  | 'spine';

export type JointAngleUnavailableReason =
  | 'MISSING_LANDMARK'
  | 'LOW_CONFIDENCE'
  | 'INVALID_GEOMETRY'
  | 'LANDMARK_CONFUSION'
  | 'SUDDEN_JUMP';

export type JointAngleReading =
  | {
      available: true;
      angle: number;
      confidence: number;
    }
  | {
      available: false;
      reason: JointAngleUnavailableReason;
      confidence?: number;
    };

export interface JointAnglesSnapshot {
  timestamp: number;
  coordinateSpace: 'world' | 'image';
  joints: Record<TrackableJointName, JointAngleReading>;
}

export type VisionErrorCode =
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_NOT_READABLE'
  | 'CAMERA_UNKNOWN'
  | 'POSE_INIT_FAILED'
  | 'POSE_NOT_READY'
  | 'SCAN_NOT_READY'
  | 'SCAN_FAILED'
  | 'VIDEO_NOT_ATTACHED'
  | 'UNSUPPORTED';

export interface VisionErrorInfo {
  code: VisionErrorCode;
  message: string;
}
