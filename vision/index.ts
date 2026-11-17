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
  cameraFrameRect,
  clipSegmentToRect,
  drawPoseWireframe,
  fitLandmarkToCanvas,
  mapNormalizedToContainCanvas,
  jointRadiusForVisibility,
  WIREFRAME_MIN_VISIBILITY,
  WIREFRAME_SEGMENTS,
} from './pose/wireframe';
export { EyePositionTracker, LandmarkVisibilityGate } from './pose/wireframeTracking';
export {
  cameraToBody,
  createMirrorProjection,
  DEFAULT_MIRROR_GEOMETRY,
  glassToCanvas,
  reflectOnGlass,
} from './pose/mirrorReflection';
export type { MirrorGeometry, MirrorPoint } from './pose/mirrorReflection';
export { drawHandWireframes, handsOfPose, HAND_WIREFRAME_SEGMENTS } from './hand/handWireframe';
export { ExerciseSessionController } from './exercise/ExerciseSessionController';
export type { ExerciseFrameListener, ExerciseFramePayload, ExerciseFrameDiagnostics } from './exercise/ExerciseSessionController';
export type { JointAngleOptions } from './pose/jointAngles';
export { angleAtVertex, distance3D } from './math/angles';
export { RepDetector } from './exercise/RepDetector';
export { summarizePosture, METRIC_INFO as POSTURE_METRIC_INFO } from './pose/postureMetrics';
export type { PostureFinding, PostureMetricsSummary, PostureRegion } from './pose/postureMetrics';
export {
  applyRepAngleRanges,
  repAngleRangesFor,
  REP_ANGLE_RANGES,
  EXERCISE_ID_RANGES,
  EXERCISE_NAME_RANGES,
} from './exercise/repAngleRanges';
export type { AngleRange, ExerciseAngleRanges, JointRepRange, RepAngleRangeKey } from './exercise/repAngleRanges';
export { ExerciseTracker } from './exercise/ExerciseTracker';
export type { BodySide, FaultStatus, FormResult, KneeLineFaultCode, Tilt } from './exercise/formCommon';
export { measureSquatForm, SquatFormMonitor, SQUAT_FAULT_PRIORITY } from './exercise/squatForm';
export type {
  KneeLineReading,
  SquatFaultCode,
  SquatFaultStatus,
  SquatFormFrame,
  SquatFormResult,
  SquatView,
} from './exercise/squatForm';
export { measureLungeForm, LungeFormMonitor, LUNGE_FAULT_PRIORITY } from './exercise/lungeForm';
export type {
  LungeFaultCode,
  LungeFaultStatus,
  LungeFormFrame,
  LungeFormResult,
  LungeKneeLine,
  LungeSideAngles,
} from './exercise/lungeForm';
export { measureDeadliftForm, DeadliftFormMonitor, DEADLIFT_FAULT_PRIORITY } from './exercise/deadliftForm';
export type {
  DeadliftBackCheck,
  DeadliftFaultCode,
  DeadliftFormFrame,
  DeadliftFormResult,
} from './exercise/deadliftForm';
export { estimateSpineCurve, SpineCurveTracker, SPINE_CURVE_POINT_COUNT } from './posture/SpineCurveDetector';
export type { SpineCurve, SpineCurvePoint, SpineCurveRegion, SpineEstimateSource } from './posture/SpineCurveDetector';
export {
  assessNeutralSpineProfile,
  getNeutralSpineProfile,
  resetNeutralSpineProfile,
  setNeutralSpineProfile,
  subscribeNeutralSpineProfile,
} from './posture/NeutralSpineCalibrator';
export type { CalibrationStatus, NeutralSpineProfile, SpineSignalSource } from './posture/NeutralSpineCalibrator';
export type { SpinePoseStatus } from './spine/SpinePoseEstimator';
export { ExerciseFormMonitor, formRanges, formScoresReps, leadSideFromName } from './exercise/exerciseForm';
export {
  DEFAULT_RANGE_TOLERANCE_DEG,
  isRangeModelFormCheck,
  judgeInRange,
  LUNGE_RANGE_MODELS,
  rangeModelFor,
  rangeModelsFor,
  SQUAT_RANGE_MODELS,
  tibiaBandFor,
  TIBIA_TOE_OUT_BANDS,
  TIBIA_TOLERANCE_DEG,
} from './exercise/angleRangeModels';
export type {
  DegreeRange,
  LungeModelId,
  LungeRangeModel,
  RangeJudgement,
  RangeModel,
  RangeModelFormCheck,
  RangeVerdict,
  RangeView,
  SquatModelId,
  SquatRangeModel,
  TibiaBand,
} from './exercise/angleRangeModels';
export { RangeRepJudge, summarizeRangeReps } from './exercise/rangeRepJudge';
export type {
  RangeAngle,
  RangeCheck,
  RangeLiveCheck,
  RangeRep,
  RangeSample,
  RangeSessionState,
  RangeSetSummary,
  RangeTally,
  RangeTallyKey,
} from './exercise/rangeRepJudge';
export type { ExerciseFormResult, FormFaultCode } from './exercise/exerciseForm';
export { drawExerciseFormOverlay } from './exercise/formOverlay';

export type {
  Exercise,
  ExerciseFormCheck,
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
