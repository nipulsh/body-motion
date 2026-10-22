import type {
  CapturedScanImage,
  OrientationResult,
  RotationDebugInfo,
  RotationState,
  ScanGuidance,
  ScanQuality,
  ScanState,
  VisionErrorInfo,
} from './types';
import type { ScanCaptureMode } from './scanning/scanCaptureMode';

export type VisionEventType =
  | 'CAMERA_STARTED'
  | 'CAMERA_STOPPED'
  | 'POSE_READY'
  | 'SCAN_STARTED'
  | 'SCAN_READY'
  | 'SCAN_PROGRESS'
  | 'IMAGE_CAPTURED'
  | 'GUIDANCE'
  | 'QUALITY'
  | 'SCAN_PAUSED'
  | 'SCAN_RESUMED'
  | 'SCAN_COMPLETED'
  | 'SCAN_CANCELLED'
  | 'SCAN_ERROR';

export interface VisionSnapshot {
  scanCaptureMode: ScanCaptureMode;
  scanState: ScanState;
  guidance: ScanGuidance | null;
  orientation: OrientationResult | null;
  rotation: RotationState | null;
  capturedCount: number;
  targetCount: number;
  /** Live thumbnails of images captured so far in this scan session. */
  capturedImages: CapturedScanImage[];
  quality: ScanQuality | null;
  cameraReady: boolean;
  poseReady: boolean;
  error: VisionErrorInfo | null;
  lastEvent: VisionEventType | null;
  debugRotation: RotationDebugInfo | null;
}

export interface VisionEventPayload {
  event: VisionEventType;
  state: VisionSnapshot;
}

export type VisionListener = (payload: VisionEventPayload) => void;
