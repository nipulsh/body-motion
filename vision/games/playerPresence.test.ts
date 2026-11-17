import { describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../types';
import {
  createPlayerPresence,
  DEFAULT_PLAYER_PRESENCE_CONFIG,
  isPlayerInView,
  notePlayerPresence,
  playerPresenceStatus,
} from './playerPresence';

const { warnAfterMs, leaveAfterMs } = DEFAULT_PLAYER_PRESENCE_CONFIG;

function pose(seen: PoseLandmarkName[]): PoseResult {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const name of seen) {
    landmarks[POSE_LANDMARK_INDEX[name]] = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
  }
  return { landmarks, confidence: 0.9, timestamp: 0 };
}

describe('player presence', () => {
  it('counts a person only when enough of the torso is in view', () => {
    expect(isPlayerInView(null)).toBe(false);
    expect(isPlayerInView(pose(['leftShoulder']))).toBe(false);
    expect(isPlayerInView(pose(['leftShoulder', 'leftHip']))).toBe(true);
  });

  it('stays open until the camera reports, so a slow start does not close the game', () => {
    expect(playerPresenceStatus(createPlayerPresence(), 60_000).phase).toBe('waiting');
  });

  it('closes an empty mirror after the leave window, with a countdown first', () => {
    const state = notePlayerPresence(createPlayerPresence(), false, 1_000);
    expect(playerPresenceStatus(state, 1_000 + warnAfterMs - 1).phase).toBe('waiting');
    expect(playerPresenceStatus(state, 1_000 + warnAfterMs)).toEqual({
      phase: 'leaving',
      secondsLeft: Math.ceil((leaveAfterMs - warnAfterMs) / 1000),
    });
    expect(playerPresenceStatus(state, 1_000 + leaveAfterMs).phase).toBe('left');
  });

  it('cancels the countdown when someone steps in front', () => {
    const empty = notePlayerPresence(createPlayerPresence(), false, 1_000);
    const back = notePlayerPresence(empty, true, 1_000 + warnAfterMs + 500);
    expect(playerPresenceStatus(back, 1_000 + warnAfterMs + 500).phase).toBe('present');
  });

  it('closes after someone who was in view steps away', () => {
    const seen = notePlayerPresence(createPlayerPresence(), true, 1_000);
    const gone = notePlayerPresence(seen, false, 1_500);
    expect(playerPresenceStatus(gone, 1_000 + warnAfterMs - 1).phase).toBe('present');
    expect(playerPresenceStatus(gone, 1_000 + warnAfterMs).phase).toBe('leaving');
    expect(playerPresenceStatus(gone, 1_000 + leaveAfterMs).phase).toBe('left');
  });
});
