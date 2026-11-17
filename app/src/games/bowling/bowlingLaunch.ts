import type { SwingRelease } from '@vision/games/bowling/bowlingSwing';
import { BALL, LANE } from './bowlingDimensions';
import type { LaunchParams } from './bowlingPhysics';

export interface LaunchConfig {
  /**
   * Ball speed per unit of hand speed. A bowler's approach steps add speed that a
   * standing, one-leg swing can't, so a comfortable swing lands near real league
   * speeds (6–8 m/s) instead of a 3 m/s roll.
   */
  speedGain: number;
  minSpeed: number;
  /** About 21 mph, the top of the pro range. */
  maxSpeed: number;
  /** Arm direction is noisy; a few degrees of real launch angle already cross the lane. */
  aimGain: number;
  maxAimRad: number;
  /** Margin from the lane edge for the start position, meters. */
  edgeMargin: number;
}

export const DEFAULT_LAUNCH_CONFIG: LaunchConfig = {
  speedGain: 2.2,
  minSpeed: 3,
  maxSpeed: 9.5,
  aimGain: 0.12,
  maxAimRad: (2.5 * Math.PI) / 180,
  edgeMargin: 0.01,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Lane x for a start position in -1 (left edge) .. 1 (right edge). */
export function laneXForStart(startX: number, config: LaunchConfig = DEFAULT_LAUNCH_CONFIG): number {
  const maxX = LANE.halfWidth - BALL.radius - config.edgeMargin;
  const s = Number.isFinite(startX) ? clamp(startX, -1, 1) : 0;
  return s * maxX;
}

export function launchFromRelease(
  release: SwingRelease,
  startX: number,
  config: LaunchConfig = DEFAULT_LAUNCH_CONFIG,
): LaunchParams {
  const hand = Number.isFinite(release.handSpeed) ? Math.max(0, release.handSpeed) : 0;
  const lateral = Number.isFinite(release.lateralAngle) ? release.lateralAngle : 0;
  return {
    x: laneXForStart(startX, config),
    speed: clamp(hand * config.speedGain, config.minSpeed, config.maxSpeed),
    angle: clamp(lateral * config.aimGain, -config.maxAimRad, config.maxAimRad),
  };
}
