import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseResult } from '@vision';
import {
  createPlayerPresence,
  isPlayerInView,
  notePlayerPresence,
  playerPresenceStatus,
} from '@vision/games/playerPresence';

/** The pose feed goes quiet when nobody is in view, so a clock decides when the player has gone. */
const CHECK_MS = 200;

/**
 * Closes a mirror game when the player steps out of the mirror. Feed every pose
 * (or null) to `notePose`. `secondsLeft` is set while the closing countdown runs.
 */
export function usePlayerWalkAway(onLeave: () => void, enabled = true) {
  const stateRef = useRef(createPlayerPresence());
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const notePose = useCallback((pose: PoseResult | null) => {
    stateRef.current = notePlayerPresence(stateRef.current, isPlayerInView(pose), performance.now());
  }, []);

  useEffect(() => {
    // Start each watch from scratch: an old sighting must not close the game the moment it turns on.
    stateRef.current = createPlayerPresence();
    setSecondsLeft(null);
    if (!enabled) return;

    let done = false;
    const id = window.setInterval(() => {
      if (done) return;
      const status = playerPresenceStatus(stateRef.current, performance.now());
      setSecondsLeft(status.phase === 'leaving' ? status.secondsLeft : null);
      if (status.phase === 'left') {
        done = true;
        window.clearInterval(id);
        onLeaveRef.current();
      }
    }, CHECK_MS);

    return () => {
      done = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return { notePose, secondsLeft };
}
