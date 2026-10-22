import { VISION_CONFIG } from '../config';
import type {
  BodyVisibility,
  MovementQuality,
  QualityIssue,
  ScanQuality,
} from '../types';

export interface ScanQualityInput {
  visibility: BodyVisibility;
  poseConfidence: number;
  orientationConfidence: number;
  movement: MovementQuality;
  bodyCenterX: number | null;
  frameWidth: number;
  frameHeight: number;
}

export function evaluateScanQuality(input: ScanQualityInput): ScanQuality {
  const { quality } = VISION_CONFIG;
  const centered =
    input.bodyCenterX !== null &&
    input.bodyCenterX >= quality.bodyCenterMinX &&
    input.bodyCenterX <= quality.bodyCenterMaxX;
  const frameSized =
    input.frameWidth >= quality.minimumFrameWidth &&
    input.frameHeight >= quality.minimumFrameHeight;

  const issues: QualityIssue[] = [];
  if (!input.visibility.visible) issues.push('BODY_NOT_VISIBLE');
  if (input.poseConfidence < quality.minimumPoseConfidence) issues.push('LOW_POSE_CONFIDENCE');
  if (input.orientationConfidence < quality.minimumOrientationConfidence) {
    issues.push('LOW_ORIENTATION_CONFIDENCE');
  }
  if (input.movement.tooFast) issues.push('TOO_FAST');
  if (input.movement.tooSlow) issues.push('TOO_SLOW');
  if (!centered) issues.push('NOT_CENTERED');
  if (!frameSized) issues.push('FRAME_TOO_SMALL');

  const usable =
    input.visibility.visible &&
    input.poseConfidence >= quality.minimumPoseConfidence &&
    input.orientationConfidence >= quality.minimumOrientationConfidence &&
    !input.movement.tooFast &&
    centered &&
    frameSized;

  return {
    usable,
    poseConfidence: input.poseConfidence,
    orientationConfidence: input.orientationConfidence,
    visibility: input.visibility,
    movement: input.movement,
    centered,
    frameSized,
    issues,
  };
}
