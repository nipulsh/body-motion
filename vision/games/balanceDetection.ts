import { angleAtVertex } from '../math/angles';
import { getLandmark } from '../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../types';

export type SupportLeg = 'left' | 'right' | 'none';

export interface OneLegBalanceResult {
  balanced: boolean;
  supportLeg: SupportLeg;
  confidence: number;
  detail: string;
}

export interface OneLegBalanceConfig {
  minVisibility: number;
  /** Min normalized vertical gap: support ankle y minus lifted ankle y (image y grows downward). */
  minAnkleLift: number;
  minSupportKneeAngle: number;
}

export const DEFAULT_ONE_LEG_BALANCE_CONFIG: OneLegBalanceConfig = {
  minVisibility: 0.45,
  minAnkleLift: 0.07,
  minSupportKneeAngle: 135,
};

function kneeAngleFromLandmarks(
  landmarks: readonly PoseLandmark[],
  side: 'left' | 'right',
  minVisibility: number,
): number | null {
  const hip = getLandmark(landmarks, side === 'left' ? 'leftHip' : 'rightHip');
  const knee = getLandmark(landmarks, side === 'left' ? 'leftKnee' : 'rightKnee');
  const ankle = getLandmark(landmarks, side === 'left' ? 'leftAnkle' : 'rightAnkle');
  if (!hip || !knee || !ankle) return null;
  if ([hip, knee, ankle].some((lm) => lm.visibility < minVisibility)) return null;
  const angle = angleAtVertex(
    { x: hip.x, y: hip.y, z: hip.z },
    { x: knee.x, y: knee.y, z: knee.z },
    { x: ankle.x, y: ankle.y, z: ankle.z },
  );
  return Number.isFinite(angle) ? angle : null;
}

export function detectOneLegBalanceFromLandmarks(
  landmarks: readonly PoseLandmark[],
  config: OneLegBalanceConfig = DEFAULT_ONE_LEG_BALANCE_CONFIG,
): OneLegBalanceResult {
  const leftAnkle = getLandmark(landmarks, 'leftAnkle');
  const rightAnkle = getLandmark(landmarks, 'rightAnkle');
  const leftKnee = getLandmark(landmarks, 'leftKnee');
  const rightKnee = getLandmark(landmarks, 'rightKnee');

  const required = [leftAnkle, rightAnkle, leftKnee, rightKnee];
  if (required.some((lm) => !lm || lm.visibility < config.minVisibility)) {
    return { balanced: false, supportLeg: 'none', confidence: 0, detail: 'feet_not_visible' };
  }

  const liftGap = leftAnkle!.y - rightAnkle!.y;
  const leftKneeAngle = kneeAngleFromLandmarks(landmarks, 'left', config.minVisibility);
  const rightKneeAngle = kneeAngleFromLandmarks(landmarks, 'right', config.minVisibility);

  if (leftKneeAngle == null || rightKneeAngle == null) {
    return { balanced: false, supportLeg: 'none', confidence: 0.2, detail: 'knee_angles_unavailable' };
  }

  const tryLeftSupport = (): OneLegBalanceResult | null => {
    if (liftGap < config.minAnkleLift) return null;
    if (leftKneeAngle < config.minSupportKneeAngle) return null;
    const conf = Math.min(1, liftGap / (config.minAnkleLift * 2));
    return {
      balanced: true,
      supportLeg: 'left',
      confidence: conf,
      detail: 'balanced_on_left',
    };
  };

  const tryRightSupport = (): OneLegBalanceResult | null => {
    if (-liftGap < config.minAnkleLift) return null;
    if (rightKneeAngle < config.minSupportKneeAngle) return null;
    const conf = Math.min(1, -liftGap / (config.minAnkleLift * 2));
    return {
      balanced: true,
      supportLeg: 'right',
      confidence: conf,
      detail: 'balanced_on_right',
    };
  };

  const left = tryLeftSupport();
  if (left) return left;
  const right = tryRightSupport();
  if (right) return right;

  return {
    balanced: false,
    supportLeg: 'none',
    confidence: 0.35,
    detail: 'both_feet_down_or_unclear',
  };
}

export function detectOneLegBalance(
  pose: PoseResult | null,
  config: OneLegBalanceConfig = DEFAULT_ONE_LEG_BALANCE_CONFIG,
): OneLegBalanceResult {
  if (!pose?.landmarks?.length) {
    return { balanced: false, supportLeg: 'none', confidence: 0, detail: 'no_pose' };
  }
  return detectOneLegBalanceFromLandmarks(pose.landmarks, config);
}
