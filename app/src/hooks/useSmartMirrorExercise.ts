import { useEffect, useRef, useState } from 'react';
import { getVisionManager, type RepDetectionResult } from '@vision';
import {
  mirrorExerciseSnapshot,
  mirrorSnapshotsEqual,
  type SmartMirrorExerciseSnapshot,
} from '../components/screens/smartMirrorExercise';

const EMPTY_SNAPSHOT: SmartMirrorExerciseSnapshot = {
  exercise: null,
  repCount: null,
  targetReps: null,
};

/**
 * Reads the exercise already running in VisionManager.
 * Rep updates come from the existing session frames, and React state changes
 * only when the exercise or the counted repetitions change.
 */
export function useSmartMirrorExercise(): SmartMirrorExerciseSnapshot {
  const [snapshot, setSnapshot] = useState<SmartMirrorExerciseSnapshot>(EMPTY_SNAPSHOT);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    const manager = getVisionManager();

    const publish = (result: RepDetectionResult | null) => {
      const next = mirrorExerciseSnapshot(
        manager.getActiveExercise(),
        result ?? manager.getLastRepResult(),
      );
      if (mirrorSnapshotsEqual(snapshotRef.current, next)) return;
      snapshotRef.current = next;
      setSnapshot(next);
    };

    publish(manager.getLastRepResult());
    return manager.subscribeExerciseFrame((payload) => {
      publish(payload.result);
    });
  }, []);

  return snapshot;
}
