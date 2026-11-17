import { angleFromVertical, LM, mid, sideIdx, type P2, type Side } from '../core/geometry';
import type { BasePose } from '../core/types';

/**
 * Foot height above the base floor line, percent of leg length. Uses the lower
 * of heel and foot index (larger image y), so a heel kick does not count.
 */
export function footHeight(pts: readonly P2[], base: BasePose, side: Side, scale = 1): number {
  const i = sideIdx(side);
  const lowest = Math.max(pts[i.heel].y, pts[i.foot].y);
  const leg = base.legLength * scale;
  return leg > 1e-6 ? ((base.floorY[side] - lowest) / leg) * 100 : 0;
}

/** Knee rise above its standing height, percent of leg length. */
export function kneeRise(pts: readonly P2[], base: BasePose, side: Side, scale = 1): number {
  const i = sideIdx(side);
  const leg = base.legLength * scale;
  return leg > 1e-6 ? ((base.kneeY[side] - pts[i.knee].y) / leg) * 100 : 0;
}

/** Sideways drift of the foot from its lane centre, in hip widths. */
export function footDrift(pts: readonly P2[], base: BasePose, side: Side, scale = 1): number {
  const i = sideIdx(side);
  const hw = base.hipWidth * scale;
  const footX = (pts[i.ankle].x + pts[i.heel].x + pts[i.foot].x) / 3;
  return hw > 1e-6 ? Math.abs(footX - base.ankleX[side]) / hw : 0;
}

export function trunkLeanDeg(pts: readonly P2[]): number {
  return angleFromVertical(mid(pts[LM.lHip], pts[LM.rHip]), mid(pts[LM.lShoulder], pts[LM.rShoulder]), true);
}
