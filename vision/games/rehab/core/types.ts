import type { P2, Side, V3 } from './geometry';

export type View = 'front' | 'side' | 'unknown';
export type RequiredView = 'front' | 'side' | 'either';
export type FormState = 'good' | 'borderline' | 'incorrect';

/** One smoothed, person-locked pose frame in image space (see `P2`). */
export interface RehabFrame {
  /** Capture time, seconds on the performance clock. */
  t: number;
  pts: P2[];
  vis: number[];
  /** MediaPipe world landmarks in metres (hip-centred), smoothed. */
  world: V3[] | null;
  /** Frame width / height. */
  aspect: number;
  view: View;
  /**
   * Live size of the body against the base (1 = same distance as at base).
   * Multiply base lengths by this so a patient who drifts closer keeps the same ratios.
   */
  scale: number;
}

/** Standing reference captured at the start of every session. Lengths are image units. */
export interface BasePose {
  legLength: number;
  torsoLength: number;
  shoulderWidth: number;
  hipWidth: number;
  armLength: number;
  thighLength: number;
  shinLength: number;
  stanceWidth: number;
  /** Standing hip height above the ankles (H0). */
  hipHeight: number;
  /** Image y of the floor under each foot (average of heel and foot index). */
  floorY: Record<Side, number>;
  kneeY: Record<Side, number>;
  /** Foot index y minus heel y when standing flat. */
  heelToeDiff: Record<Side, number>;
  toeOutDeg: Record<Side, number>;
  trunkAngleDeg: number;
  /** Standing shoulder-to-hip distance (D0). */
  shoulderHipDist: number;
  midlineX: number;
  hipMid: P2;
  ankleX: Record<Side, number>;
  view: View;
  seated: boolean;
}

export interface TrackingStatus {
  frame: RehabFrame | null;
  healthy: boolean;
  message: string | null;
  base: BasePose | null;
  /** 0..1 progress of the stand-still check before the base locks. */
  baseProgress: number;
  view: View;
  /** False while frames are rejected as a different person. */
  personLocked: boolean;
}

export function ranges<T>(left: T, right: T): Record<Side, T> {
  return { left, right };
}
