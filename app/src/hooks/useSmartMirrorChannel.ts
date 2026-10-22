import { useEffect, useState } from 'react';
import type { PoseResult } from '@vision';
import type { TrackedHand } from '@vision/hand/handLandmarksBus';
import { mirrorEmitTo, listenMirrorEvent } from '../desktop/mirrorEvents';
import {
  decodeMirrorExercise,
  decodeMirrorPose,
  decodeMirrorStatus,
  MIRROR_EXERCISE_EVENT,
  MIRROR_POSE_EVENT,
  MIRROR_POSE_STALE_MS,
  MIRROR_READY_EVENT,
  MIRROR_STATUS_EVENT,
  type MirrorExerciseMessage,
} from '../display/mirrorChannel';
export interface MirrorFrameSink {
  current: (
    pose: PoseResult | null,
    frame: { width: number; height: number } | null,
    hands?: readonly TrackedHand[],
  ) => void;
}

const WAITING = 'Waiting for the laptop camera.';
const STALE = 'The pose stream stopped. Check the laptop camera.';

/**
 * Receives pose and exercise updates from the main window.
 * This window does not start a camera or a rep counter.
 */
export function useSmartMirrorChannel(frameSink: MirrorFrameSink): {
  exercise: MirrorExerciseMessage | null;
  error: string | null;
} {
  const [exercise, setExercise] = useState<MirrorExerciseMessage | null>(null);
  const [error, setError] = useState<string | null>(WAITING);

  useEffect(() => {
    let cancelled = false;
    let staleTimer = 0;
    const unlistens: Array<() => void> = [];
    const sink = () => frameSink.current;

    const armStale = () => {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => {
        sink()(null, null, []);
        setError((current) => (current && current !== WAITING ? current : STALE));
      }, MIRROR_POSE_STALE_MS);
    };

    const remember = (unlisten: () => void) => {
      if (cancelled) unlisten();
      else unlistens.push(unlisten);
    };

    void listenMirrorEvent(MIRROR_POSE_EVENT, (payload) => {
      const decoded = decodeMirrorPose(payload, Date.now());
      if (decoded.kind === 'invalid') return;
      if (decoded.kind === 'stale') {
        sink()(null, null, []);
        setError(STALE);
        return;
      }
      sink()(decoded.pose, decoded.frame, decoded.hands);
      if (decoded.pose?.landmarks?.length) {
        setError(null);
        armStale();
      }
    }).then(remember).catch(() => undefined);

    void listenMirrorEvent(MIRROR_EXERCISE_EVENT, (payload) => {
      const decoded = decodeMirrorExercise(payload);
      if (payload != null && !decoded) return;
      setExercise(decoded);
    }).then(remember).catch(() => undefined);

    void listenMirrorEvent(MIRROR_STATUS_EVENT, (payload) => {
      const message = decodeMirrorStatus(payload);
      if (message) setError(message);
    }).then(remember).catch(() => undefined);

    const announce = () => {
      if (!cancelled) mirrorEmitTo('main', MIRROR_READY_EVENT, null);
    };
    announce();
    const retry = window.setInterval(announce, 500);
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 2000);

    return () => {
      cancelled = true;
      window.clearTimeout(staleTimer);
      window.clearTimeout(stopRetry);
      window.clearInterval(retry);
      for (const unlisten of unlistens) unlisten();
      sink()(null, null, []);
    };
  }, [frameSink]);

  return { exercise, error };
}
