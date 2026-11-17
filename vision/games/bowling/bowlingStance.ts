import { POSE_LANDMARK_INDEX } from '../../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../../types';
import type { OneLegBalanceResult, SupportLeg } from '../balanceDetection';

/**
 * One-leg stance tracker for the bowling game.
 *
 * The shared one-leg check compares the two ankles against a fixed slice of the
 * camera picture, so a player standing a little further back has to lift much
 * higher, and it drops the player whenever the raised ankle hides behind the
 * other leg. This tracker instead:
 * - measures each foot by its lowest point (ankle, heel or toe), so a pointed
 *   or tucked foot still reads;
 * - scales the lift by the player's own leg length, so distance from the mirror
 *   doesn't change how high the foot must go;
 * - only needs the standing foot to be clearly visible; the raised one may be
 *   partly hidden;
 * - learns the small height difference between the feet while both are down
 *   (one foot slightly ahead looks higher on camera);
 * - uses a hysteresis band and a short debounce so the reading doesn't flicker
 *   between "one leg" and "two feet" on noisy frames.
 */

export interface StanceTrackerConfig {
  /** The standing foot and hips must be at least this visible. */
  supportMinVisibility: number;
  /** The raised foot often hides behind the standing leg, so it is read at a much lower visibility. */
  liftedMinVisibility: number;
  /** Raised-foot height, as a share of leg length, that counts as one leg. */
  liftEnter: number;
  /** Once on one leg, the foot counts as down only when it drops below this share. */
  liftExit: number;
  /** Frames in a row over `liftEnter` before one leg is reported. */
  enterFrames: number;
  /** Time below `liftExit` before the foot counts as down (ms). */
  exitMs: number;
  /** Time constant for learning the feet's resting height difference (ms). */
  restTimeConstantMs: number;
  /** The learned resting difference stays within this share of leg length, so a slow lift isn't learned away. */
  maxRestOffset: number;
  /** A pose gap longer than this restarts the tracker (ms). */
  maxGapMs: number;
  /** Shorter legs than this (frame heights) mean a bad fit or a player far too small to read. */
  minLegLength: number;
}

export const DEFAULT_STANCE_TRACKER_CONFIG: StanceTrackerConfig = {
  supportMinVisibility: 0.5,
  liftedMinVisibility: 0.1,
  liftEnter: 0.06,
  liftExit: 0.03,
  enterFrames: 2,
  exitMs: 200,
  restTimeConstantMs: 1500,
  maxRestOffset: 0.08,
  maxGapMs: 600,
  minLegLength: 0.08,
};

export interface StanceTrackerState {
  /** Resting (left floor y − right floor y) / leg length, learned while both feet are down. */
  restOffset: number;
  supportLeg: SupportLeg;
  /** Consecutive frames over the enter threshold, signed toward the side that would be the support leg. */
  enterCount: number;
  enterSide: SupportLeg;
  belowSince: number | null;
  lastT: number | null;
  /** Last measured lift, share of leg length (0 when unknown). For debugging and tuning. */
  lift: number;
}

export function createStanceTracker(): StanceTrackerState {
  return {
    restOffset: 0,
    supportLeg: 'none',
    enterCount: 0,
    enterSide: 'none',
    belowSince: null,
    lastT: null,
    lift: 0,
  };
}

type Side = 'left' | 'right';

const IDX = {
  left: {
    hip: POSE_LANDMARK_INDEX.leftHip,
    ankle: POSE_LANDMARK_INDEX.leftAnkle,
    heel: POSE_LANDMARK_INDEX.leftHeel,
    toe: POSE_LANDMARK_INDEX.leftFootIndex,
  },
  right: {
    hip: POSE_LANDMARK_INDEX.rightHip,
    ankle: POSE_LANDMARK_INDEX.rightAnkle,
    heel: POSE_LANDMARK_INDEX.rightHeel,
    toe: POSE_LANDMARK_INDEX.rightFootIndex,
  },
} as const;

function usable(lm: PoseLandmark | undefined, minVisibility: number): lm is PoseLandmark {
  return Boolean(
    lm && Number.isFinite(lm.x) && Number.isFinite(lm.y) && (lm.visibility ?? 0) >= minVisibility,
  );
}

interface FootReading {
  /** Lowest point of the foot, normalized image y. */
  floorY: number;
  /** Best visibility among the foot's points. */
  visibility: number;
  /** Hip-to-ankle length in frame heights, or null when the ankle isn't readable. */
  legLength: number | null;
}

function readFoot(landmarks: readonly PoseLandmark[], side: Side, aspect: number, cfg: StanceTrackerConfig): FootReading | null {
  const idx = IDX[side];
  const points = [landmarks[idx.ankle], landmarks[idx.heel], landmarks[idx.toe]].filter((lm) =>
    usable(lm, cfg.liftedMinVisibility),
  );
  if (points.length === 0) return null;
  const hip = landmarks[idx.hip];
  const ankle = landmarks[idx.ankle];
  const legLength =
    usable(hip, cfg.liftedMinVisibility) && usable(ankle, cfg.liftedMinVisibility)
      ? Math.hypot((ankle.x - hip.x) * aspect, ankle.y - hip.y)
      : null;
  return {
    floorY: Math.max(...points.map((p) => p.y)),
    visibility: Math.max(...points.map((p) => p.visibility ?? 0)),
    legLength,
  };
}

function result(balanced: boolean, supportLeg: SupportLeg, confidence: number, detail: string): OneLegBalanceResult {
  return { balanced, supportLeg, confidence, detail };
}

function report(state: StanceTrackerState, cfg: StanceTrackerConfig): OneLegBalanceResult {
  if (state.supportLeg === 'none') {
    return result(false, 'none', 0.35, 'both_feet_down_or_unclear');
  }
  const confidence = Math.min(1, Math.max(0, state.lift / (cfg.liftEnter * 2)));
  return result(true, state.supportLeg, confidence, `balanced_on_${state.supportLeg}`);
}

/** Feeds one pose frame. `t` is in ms. */
export function updateStanceTracker(
  prev: StanceTrackerState,
  pose: PoseResult | null,
  t: number,
  cfg: StanceTrackerConfig = DEFAULT_STANCE_TRACKER_CONFIG,
): { state: StanceTrackerState; balance: OneLegBalanceResult } {
  let state: StanceTrackerState = { ...prev };
  if (state.lastT !== null && (!(t >= state.lastT) || t - state.lastT > cfg.maxGapMs)) {
    state = { ...createStanceTracker(), restOffset: state.restOffset };
  }
  const dtMs = state.lastT === null ? 0 : t - state.lastT;

  const landmarks = pose?.landmarks;
  if (!landmarks || landmarks.length < 33) {
    // Keep the stance through a dropped frame; the throw flow has its own grace for gaps.
    return { state, balance: result(false, 'none', 0, 'no_pose') };
  }
  state.lastT = t;

  const aspect = pose.frameAspect && Number.isFinite(pose.frameAspect) && pose.frameAspect > 0 ? pose.frameAspect : 1;
  const hipsSeen =
    usable(landmarks[IDX.left.hip], cfg.supportMinVisibility) &&
    usable(landmarks[IDX.right.hip], cfg.supportMinVisibility);
  const left = readFoot(landmarks, 'left', aspect, cfg);
  const right = readFoot(landmarks, 'right', aspect, cfg);
  const anyFootClear =
    (left?.visibility ?? 0) >= cfg.supportMinVisibility || (right?.visibility ?? 0) >= cfg.supportMinVisibility;
  if (!hipsSeen || !anyFootClear) {
    state.enterCount = 0;
    return { state, balance: result(false, 'none', 0, 'feet_not_visible') };
  }

  if (!left || !right) {
    // One foot can't be read at all: a raised foot tucked fully behind the standing leg
    // looks like this, so an existing one-leg stance holds, but a new one can't start.
    state.enterCount = 0;
    return { state, balance: report(state, cfg) };
  }

  // The support leg is straight, so the longer of the two is the true leg length.
  const legLength = Math.max(left.legLength ?? 0, right.legLength ?? 0);
  if (!(legLength >= cfg.minLegLength)) {
    state.enterCount = 0;
    return { state, balance: result(false, 'none', 0, 'feet_not_visible') };
  }

  // Positive: the left foot is lower (left standing, right raised).
  const offset = (left.floorY - right.floorY) / legLength;
  const d = offset - state.restOffset;
  const supportSide: SupportLeg = d > 0 ? 'left' : 'right';
  const standingFoot = supportSide === 'left' ? left : right;

  if (state.supportLeg === 'none') {
    state.lift = Math.abs(d);
    const clearLift = Math.abs(d) >= cfg.liftEnter && standingFoot.visibility >= cfg.supportMinVisibility;
    if (clearLift) {
      state.enterCount = state.enterSide === supportSide ? state.enterCount + 1 : 1;
      state.enterSide = supportSide;
      if (state.enterCount >= cfg.enterFrames) {
        state.supportLeg = supportSide;
        state.belowSince = null;
        state.enterCount = 0;
      }
    } else {
      state.enterCount = 0;
      state.enterSide = 'none';
      if (Math.abs(d) < cfg.liftExit && dtMs > 0) {
        const alpha = 1 - Math.exp(-dtMs / cfg.restTimeConstantMs);
        const learned = state.restOffset + (offset - state.restOffset) * alpha;
        state.restOffset = Math.min(cfg.maxRestOffset, Math.max(-cfg.maxRestOffset, learned));
      }
    }
    return { state, balance: report(state, cfg) };
  }

  // On one leg: lift measured toward the raised side.
  const lift = state.supportLeg === 'left' ? d : -d;
  state.lift = Math.max(0, lift);
  if (lift >= cfg.liftExit) {
    state.belowSince = null;
  } else {
    state.belowSince ??= t;
    if (t - state.belowSince >= cfg.exitMs) {
      state.supportLeg = 'none';
      state.belowSince = null;
      state.enterCount = 0;
      state.enterSide = 'none';
    }
  }
  return { state, balance: report(state, cfg) };
}
