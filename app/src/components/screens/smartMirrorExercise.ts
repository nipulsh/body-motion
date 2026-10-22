import type { Exercise, RepDetectionResult } from '@vision';

export interface SmartMirrorExerciseSnapshot {
  exercise: Exercise | null;
  repCount: number | null;
  targetReps: number | null;
}

export function mirrorExerciseSnapshot(
  exercise: Exercise | null,
  result: RepDetectionResult | null,
): SmartMirrorExerciseSnapshot {
  if (!exercise) {
    return { exercise: null, repCount: null, targetReps: null };
  }

  if (!result || result.exerciseId !== exercise.id) {
    return {
      exercise,
      repCount: 0,
      targetReps: exercise.recommendedReps,
    };
  }

  return {
    exercise,
    repCount: result.repCount,
    targetReps: result.targetReps,
  };
}

export function mirrorSnapshotsEqual(
  current: SmartMirrorExerciseSnapshot,
  next: SmartMirrorExerciseSnapshot,
): boolean {
  return (
    current.exercise?.id === next.exercise?.id &&
    current.exercise?.name === next.exercise?.name &&
    current.exercise?.demoVideoUrl === next.exercise?.demoVideoUrl &&
    current.repCount === next.repCount &&
    current.targetReps === next.targetReps
  );
}

export function formatMirrorRepCount(repCount: number, targetReps: number): string {
  return `${String(repCount).padStart(2, '0')} / ${String(targetReps).padStart(2, '0')}`;
}
