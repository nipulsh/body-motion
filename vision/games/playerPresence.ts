import { landmarkSeen, POSE_LANDMARK_INDEX } from '../pose/landmarks';
import type { PoseResult } from '../types';

/**
 * Walk-away exit for the mirror games. The games have no hand pointer, so a player
 * quits by stepping out of the mirror: once nobody has been seen for `leaveAfterMs`,
 * the game closes. The same clock starts when the camera is live and the mirror is
 * empty, so opening a game with nobody in front also returns to the games page.
 * A countdown shows from `warnAfterMs` so a short step aside (chasing a bird, lining
 * up a throw) does not end the game by surprise. A camera that has not started yet
 * does not count, so a slow start does not close the game.
 */
export interface PlayerPresenceConfig {
  /** How long nobody may be seen before the countdown shows. */
  warnAfterMs: number;
  /** How long nobody may be seen before the game closes. */
  leaveAfterMs: number;
  /** Visibility a torso point needs to count as seen. */
  minVisibility: number;
  /** Torso points (shoulders, hips) that must be seen for a person to count as present. */
  minTorsoPoints: number;
}

export const DEFAULT_PLAYER_PRESENCE_CONFIG: PlayerPresenceConfig = {
  warnAfterMs: 2000,
  leaveAfterMs: 5000,
  minVisibility: 0.5,
  minTorsoPoints: 2,
};

const TORSO_POINTS = [
  POSE_LANDMARK_INDEX.leftShoulder,
  POSE_LANDMARK_INDEX.rightShoulder,
  POSE_LANDMARK_INDEX.leftHip,
  POSE_LANDMARK_INDEX.rightHip,
] as const;

/** Someone is standing in the mirror: enough of the torso is in the camera. */
export function isPlayerInView(
  pose: PoseResult | null | undefined,
  config: PlayerPresenceConfig = DEFAULT_PLAYER_PRESENCE_CONFIG,
): boolean {
  const landmarks = pose?.landmarks;
  if (!landmarks?.length) return false;
  let seen = 0;
  for (const index of TORSO_POINTS) {
    if (landmarkSeen(landmarks[index], config.minVisibility)) seen += 1;
  }
  return seen >= config.minTorsoPoints;
}

export interface PlayerPresenceState {
  /** Last time a player was seen. Null until the first sighting. */
  lastSeenAt: number | null;
  /**
   * First time the camera reported a frame, person or not. Null until then, so a camera
   * that has not started yet never closes the game.
   */
  startedAt: number | null;
}

export function createPlayerPresence(): PlayerPresenceState {
  return { lastSeenAt: null, startedAt: null };
}

export function notePlayerPresence(
  state: PlayerPresenceState,
  inView: boolean,
  now: number,
): PlayerPresenceState {
  if (!Number.isFinite(now)) return state;
  const startedAt = state.startedAt ?? now;
  if (!inView) return startedAt === state.startedAt ? state : { ...state, startedAt };
  if (state.lastSeenAt === now && startedAt === state.startedAt) return state;
  return { lastSeenAt: now, startedAt };
}

export type PlayerPresencePhase = 'waiting' | 'present' | 'leaving' | 'left';

export interface PlayerPresenceStatus {
  phase: PlayerPresencePhase;
  /** Whole seconds until the game closes, shown while `phase` is 'leaving'. */
  secondsLeft: number | null;
}

export function playerPresenceStatus(
  state: PlayerPresenceState,
  now: number,
  config: PlayerPresenceConfig = DEFAULT_PLAYER_PRESENCE_CONFIG,
): PlayerPresenceStatus {
  const anchor = state.lastSeenAt ?? state.startedAt;
  if (anchor === null || !Number.isFinite(now)) return { phase: 'waiting', secondsLeft: null };
  // A clock that runs backwards (or a stale timestamp) never counts as absence.
  const absentMs = Math.max(0, now - anchor);
  if (state.lastSeenAt === null && absentMs < config.warnAfterMs) return { phase: 'waiting', secondsLeft: null };
  if (absentMs >= config.leaveAfterMs) return { phase: 'left', secondsLeft: 0 };
  if (absentMs >= config.warnAfterMs) {
    return { phase: 'leaving', secondsLeft: Math.max(1, Math.ceil((config.leaveAfterMs - absentMs) / 1000)) };
  }
  return { phase: 'present', secondsLeft: null };
}
