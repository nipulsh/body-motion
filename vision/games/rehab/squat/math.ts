import { angleFromVertical, lateralSign, LM, mid, dist, sideIdx, tiltFromHorizontal, type P2, type Side, type V3 } from '../core/geometry';
import { toeOutFromWorld } from '../core/tracking';
import type { BasePose, RehabFrame } from '../core/types';

/** Vertical distance mid-hip to mid-ankle. */
export function hipHeight(pts: readonly P2[]): number {
  return mid(pts[LM.lAnkle], pts[LM.rAnkle]).y - mid(pts[LM.lHip], pts[LM.rHip]).y;
}

/** 100 × hip height over the base hip height (H0, scaled to the live body size). */
export function hipHeightPct(pts: readonly P2[], base: BasePose, scale = 1): number {
  const h0 = base.hipHeight * scale;
  return h0 > 1e-6 ? (100 * hipHeight(pts)) / h0 : 100;
}

export function hipDropPct(pts: readonly P2[], base: BasePose, scale = 1): number {
  return 100 - hipHeightPct(pts, base, scale);
}

/** Side view: the leg nearer the camera has the higher visibility. */
export function nearerSide(vis: readonly number[]): Side {
  const score = (s: Side) => {
    const i = sideIdx(s);
    return (vis[i.hip] ?? 0) + (vis[i.knee] ?? 0) + (vis[i.ankle] ?? 0);
  };
  return score('left') >= score('right') ? 'left' : 'right';
}

export interface SideAngles {
  side: Side;
  /** Hip → knee against straight down; 90 = thigh parallel to the floor. */
  thighAngle: number;
  /** Hip → shoulder against straight up. */
  backAngle: number;
  /** Ankle → knee against straight up. */
  shinAngle: number;
}

export function sideAngles(pts: readonly P2[], vis: readonly number[]): SideAngles {
  const side = nearerSide(vis);
  const i = sideIdx(side);
  return {
    side,
    thighAngle: angleFromVertical(pts[i.hip], pts[i.knee], false),
    backAngle: angleFromVertical(pts[i.hip], pts[i.shoulder], true),
    shinAngle: angleFromVertical(pts[i.ankle], pts[i.knee], true),
  };
}

/** Front view tibia angle: ankle → knee against vertical, positive when the knee is lateral to the ankle. */
export function tibiaAngle(pts: readonly P2[], side: Side): number {
  const i = sideIdx(side);
  const a = pts[i.ankle];
  const k = pts[i.knee];
  const up = a.y - k.y;
  const lateral = (k.x - a.x) * lateralSign(pts, side);
  if (Math.abs(up) < 1e-9 && Math.abs(lateral) < 1e-9) return 0;
  return (Math.atan2(lateral, Math.max(up, 1e-9)) * 180) / Math.PI;
}

export function pelvisTilt(pts: readonly P2[]): number {
  return tiltFromHorizontal(pts[LM.lHip], pts[LM.rHip]);
}

/** Left-right height difference of knees and hips, percent of leg length. */
export function lrDiffPct(pts: readonly P2[], legLength: number): number {
  if (legLength <= 1e-6) return 0;
  const knee = Math.abs(pts[LM.lKnee].y - pts[LM.rKnee].y);
  const hip = Math.abs(pts[LM.lHip].y - pts[LM.rHip].y);
  return (100 * Math.max(knee, hip)) / legLength;
}

export function toeOut(world: readonly V3[] | null, pts: readonly P2[], side: Side): number {
  return toeOutFromWorld(world, pts, side);
}

/** 100 × (1 − shoulder-hip distance / D0). */
export function bowingPct(pts: readonly P2[], d0: number): number {
  if (d0 <= 1e-6) return 0;
  const d = dist(mid(pts[LM.lShoulder], pts[LM.rShoulder]), mid(pts[LM.lHip], pts[LM.rHip]));
  return 100 * (1 - d / d0);
}

/** Heel lift, percent of leg length, worst foot, against the standing value. */
export function heelLiftPct(pts: readonly P2[], base: BasePose, scale = 1): number {
  const leg = base.legLength * scale;
  if (leg <= 1e-6) return 0;
  const one = (s: Side) => {
    const i = sideIdx(s);
    const diff = pts[i.foot].y - pts[i.heel].y;
    return (100 * (diff - base.heelToeDiff[s] * scale)) / leg;
  };
  return Math.max(one('left'), one('right'));
}

/** Every squat measurement for one frame. */
export interface SquatMeasures {
  hipHeightPct: number;
  hipDropPct: number;
  /** Depth on the level's scale: hip drop percent (front) or thigh angle (side). */
  depth: number;
  side: SideAngles;
  tibia: Record<Side, number>;
  toeOut: Record<Side, number>;
  pelvisTilt: number;
  lrDiff: number;
  bowing: number;
  heelLift: number;
}

export function measureSquat(frame: RehabFrame, base: BasePose, view: 'front' | 'side'): SquatMeasures {
  const p = frame.pts;
  const scale = frame.scale;
  const hhp = hipHeightPct(p, base, scale);
  const side = sideAngles(p, frame.vis);
  return {
    hipHeightPct: hhp,
    hipDropPct: 100 - hhp,
    depth: view === 'front' ? 100 - hhp : side.thighAngle,
    side,
    tibia: { left: tibiaAngle(p, 'left'), right: tibiaAngle(p, 'right') },
    toeOut: frame.world
      ? { left: toeOut(frame.world, p, 'left'), right: toeOut(frame.world, p, 'right') }
      : { ...base.toeOutDeg },
    pelvisTilt: pelvisTilt(p),
    lrDiff: lrDiffPct(p, base.legLength * scale),
    bowing: bowingPct(p, base.shoulderHipDist * scale),
    heelLift: heelLiftPct(p, base, scale),
  };
}

/** Exponential smoothing of a speed (units per second) from successive values. */
export class SpeedMeter {
  private last: { t: number; v: number } | null = null;
  value = 0;
  constructor(private readonly alpha: number) {}
  update(v: number, t: number): number {
    if (this.last && t > this.last.t) {
      const raw = (v - this.last.v) / (t - this.last.t);
      this.value += (raw - this.value) * this.alpha;
    }
    this.last = { t, v };
    return this.value;
  }
  reset(): void {
    this.last = null;
    this.value = 0;
  }
}
