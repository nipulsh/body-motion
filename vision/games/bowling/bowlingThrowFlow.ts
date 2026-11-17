import type { OneLegBalanceResult } from '../balanceDetection';
import type { SwingRelease } from './bowlingSwing';

/**
 * Turn rules for the bowling game:
 * 1. Step left/right to choose where the ball starts on the lane.
 * 2. Lift one foot and hold it for `holdMs` to get the ball ready (start position locks).
 * 3. Swing the arm. The throw counts only while still on one leg.
 * Putting the foot down after the ball is ready cancels the throw.
 */

export type ThrowPhase = 'no_player' | 'positioning' | 'holding' | 'armed' | 'thrown';

export interface ThrowFlowConfig {
  holdMs: number;
  /** Brief detector dropouts (a wobble, a blurred ankle) shorter than this don't count as a foot down. */
  footDownGraceMs: number;
  /** Hip movement from frame centre (normalized image width) that reaches the lane edge. */
  aimSpan: number;
  /** Smoothing for the start-position follow (0..1 per pose frame). */
  aimSmoothing: number;
  cancelMessageMs: number;
}

export const DEFAULT_THROW_FLOW_CONFIG: ThrowFlowConfig = {
  holdMs: 1000,
  footDownGraceMs: 300,
  aimSpan: 0.25,
  aimSmoothing: 0.35,
  cancelMessageMs: 2500,
};

export interface ThrowFlowState {
  phase: ThrowPhase;
  holdStartAt: number | null;
  lastBalancedAt: number | null;
  lastSeenAt: number | null;
  /** Live start position, -1 (lane left edge) .. 1 (lane right edge), as the bowler sees it. */
  aimX: number;
  /** Start position frozen when the hold begins. */
  lockedX: number | null;
  cancelledAt: number | null;
}

export interface ThrowFlowInput {
  t: number;
  balance: OneLegBalanceResult;
  /** Hip midpoint x in the mirror view (0 left .. 1 right of the screen), or null if not seen. */
  hipX: number | null;
  release: SwingRelease | null;
  /** False while a ball is rolling or the game is over. */
  accepting: boolean;
}

export type ThrowFlowEvent =
  | { type: 'throw'; release: SwingRelease; startX: number }
  | { type: 'cancel' }
  | null;

export function createThrowFlow(): ThrowFlowState {
  return {
    phase: 'no_player',
    holdStartAt: null,
    lastBalancedAt: null,
    lastSeenAt: null,
    aimX: 0,
    lockedX: null,
    cancelledAt: null,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function playerVisible(input: ThrowFlowInput): boolean {
  if (input.hipX === null || !Number.isFinite(input.hipX)) return false;
  const d = input.balance.detail;
  return d !== 'no_pose' && d !== 'feet_not_visible';
}

export function updateThrowFlow(
  state: ThrowFlowState,
  input: ThrowFlowInput,
  config: ThrowFlowConfig = DEFAULT_THROW_FLOW_CONFIG,
): { state: ThrowFlowState; event: ThrowFlowEvent } {
  const { t } = input;
  const visible = playerVisible(input);
  const s: ThrowFlowState = { ...state };

  if (visible) {
    s.lastSeenAt = t;
    const target = clamp((input.hipX! - 0.5) / config.aimSpan, -1, 1);
    s.aimX = s.aimX + (target - s.aimX) * clamp(config.aimSmoothing, 0, 1);
  }
  const balanced = visible && input.balance.balanced;
  if (balanced) s.lastBalancedAt = t;

  const footDown = !balanced && (s.lastBalancedAt === null || t - s.lastBalancedAt > config.footDownGraceMs);
  const gone = !visible && (s.lastSeenAt === null || t - s.lastSeenAt > config.footDownGraceMs);

  const toPositioning = (cancelled: boolean): ThrowFlowState => ({
    ...s,
    phase: gone ? 'no_player' : 'positioning',
    holdStartAt: null,
    lockedX: null,
    cancelledAt: cancelled ? t : s.cancelledAt,
  });

  switch (s.phase) {
    case 'thrown': {
      if (!input.accepting) return { state: s, event: null };
      return { state: { ...toPositioning(false), cancelledAt: null }, event: null };
    }
    case 'no_player':
    case 'positioning': {
      if (!input.accepting) return { state: { ...s, phase: gone ? 'no_player' : s.phase }, event: null };
      if (gone) return { state: { ...s, phase: 'no_player' }, event: null };
      if (!visible) return { state: s, event: null };
      if (balanced) {
        return {
          state: { ...s, phase: 'holding', holdStartAt: t, lockedX: s.aimX, cancelledAt: null },
          event: null,
        };
      }
      return { state: { ...s, phase: 'positioning' }, event: null };
    }
    case 'holding': {
      if (footDown || gone || !input.accepting) return { state: toPositioning(false), event: null };
      if (s.holdStartAt !== null && t - s.holdStartAt >= config.holdMs) {
        return { state: { ...s, phase: 'armed' }, event: null };
      }
      return { state: s, event: null };
    }
    case 'armed': {
      if (!input.accepting) return { state: toPositioning(false), event: null };
      if (footDown || gone) return { state: toPositioning(true), event: { type: 'cancel' } };
      // Past the foot-down check: still on one leg, or inside a brief detector dropout.
      if (input.release) {
        return {
          state: { ...s, phase: 'thrown', holdStartAt: null },
          event: { type: 'throw', release: input.release, startX: s.lockedX ?? s.aimX },
        };
      }
      return { state: s, event: null };
    }
    default:
      return { state: s, event: null };
  }
}

/** Live start position to show the ball at: locked once the hold starts. */
export function ballStartX(state: ThrowFlowState): number {
  return state.lockedX ?? state.aimX;
}

export interface ThrowCue {
  text: string;
  /** 0..1 while holding the one-leg balance, otherwise null. */
  progress: number | null;
  tone: 'info' | 'ready' | 'warn';
}

export function throwCue(
  state: ThrowFlowState,
  t: number,
  config: ThrowFlowConfig = DEFAULT_THROW_FLOW_CONFIG,
): ThrowCue | null {
  switch (state.phase) {
    case 'thrown':
      return null;
    case 'no_player':
      return { text: 'Step back until your whole body, feet included, is in view.', progress: null, tone: 'info' };
    case 'positioning':
      if (state.cancelledAt !== null && t - state.cancelledAt < config.cancelMessageMs) {
        return { text: 'Foot down, so the throw was cancelled. Lift one foot to try again.', progress: null, tone: 'warn' };
      }
      return { text: 'Step left or right to line up the ball, then lift one foot.', progress: null, tone: 'info' };
    case 'holding': {
      const elapsed = state.holdStartAt === null ? 0 : t - state.holdStartAt;
      return { text: 'Hold steady on one leg…', progress: clamp(elapsed / config.holdMs, 0, 1), tone: 'info' };
    }
    case 'armed':
      return { text: 'Ready. Swing your arm to bowl.', progress: null, tone: 'ready' };
    default:
      return null;
  }
}
