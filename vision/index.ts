export { pickPreferredCamera, camerasInPreferenceOrder } from './camera/preferredCamera';
export { VISION_CONFIG } from './config';
export type { VisionConfig } from './config';
export { VisionError, userMessageForVisionError } from './errors';
export { VisionManager, getVisionManager } from './VisionManager';
export type { ScanCaptureMode } from './scanning/scanCaptureMode';
export { targetCaptureCount } from './scanning/scanCaptureMode';
export {
  calculateJointAngles,
  JointAngleCalculator,
  TRACKABLE_JOINTS,
} from './pose/jointAngles';
export {
  drawPoseWireframe,
  fitLandmarkToCanvas,
  mapNormalizedToContainCanvas,
  jointRadiusForVisibility,
  WIREFRAME_MIN_VISIBILITY,
  WIREFRAME_SEGMENTS,
} from './pose/wireframe';
export { drawHandWireframes, HAND_WIREFRAME_SEGMENTS } from './hand/handWireframe';
export { ExerciseSessionController } from './exercise/ExerciseSessionController';
export type { ExerciseFrameListener, ExerciseFramePayload, ExerciseFrameDiagnostics } from './exercise/ExerciseSessionController';
export type { JointAngleOptions } from './pose/jointAngles';
export { angleAtVertex, distance3D } from './math/angles';
export { RepDetector } from './exercise/RepDetector';
export { ExerciseTracker } from './exercise/ExerciseTracker';

export type {
  Exercise,
  ExerciseModality,
  MovementDirection,
  RepDetectionResult,
  RepPhase,
  RuleStatus,
  TrackingRule,
} from './exercise/types';

export { evaluateBodyVisibility } from './quality/bodyVisibility';

export type {
  BodyVisibility,
  BoundingBox,  CameraDevice,
  CapturedFrame,
  CapturedScanImage,
  FacingDirection,
  JointAngleReading,
  JointAnglesSnapshot,
  JointAngleUnavailableReason,
  JointVelocity,
  MotionState,
  MovementQuality,
  OrientationResult,
  PoseLandmark,
  PoseMetrics,
  PoseResult,
  QualityIssue,
  RotationDebugInfo,
  RotationDirection,
  RotationState,
  ScanGuidance,
  ScanQuality,
  ScanResult,
  ScanState,
  TrackableJointName,
  Vec3,
  VisionErrorCode,
  VisionErrorInfo,
} from './types';

export type {
  VisionEventPayload,
  VisionEventType,
  VisionListener,
  VisionSnapshot,
} from './events';
