import { resolveExerciseDemoVideoUrl } from '../exercise/demoVideos';
import { normalizeExercise } from '../exercise/normalizeExercise';
import { apiFetch } from './client';
import type { ExerciseResponseItem, GenerateExercisesResponse } from './types';
import type { Exercise, MovementDirection, TrackingRule } from '@vision';

const MOVEMENTS = new Set<MovementDirection>([
  'flexion',
  'extension',
  'abduction',
  'adduction',
  'internal_rotation',
  'external_rotation',
  'elevation',
  'depression',
]);

function toMovement(value: string): MovementDirection {
  if (MOVEMENTS.has(value as MovementDirection)) {
    return value as MovementDirection;
  }
  return 'flexion';
}

export function enrichExerciseWithDemoVideo(exercise: Exercise): Exercise {
  return {
    ...exercise,
    demoVideoUrl: resolveExerciseDemoVideoUrl(exercise.id, exercise.demoVideoUrl),
  };
}

export function mapExerciseFromApi(item: ExerciseResponseItem): Exercise {
  return normalizeExercise(enrichExerciseWithDemoVideo({
    id: item.id,
    name: item.name,
    description: item.description,
    targetBodyParts: item.targetBodyParts,
    difficulty: item.difficulty,
    sets: item.sets,
    recommendedReps: item.recommendedReps,
    restSeconds: item.restSeconds,
    instructions: item.instructions,
    safetyNotes: item.safetyNotes,
    demoVideoUrl: item.demoVideoUrl ?? null,
    trackingRules: item.trackingRules.map(
      (rule): TrackingRule => ({
        joint: rule.joint as TrackingRule['joint'],
        startAngle: rule.startAngle,
        requiredAngle: rule.requiredAngle,
        minimumAngle: rule.minimumAngle,
        maximumAngle: rule.maximumAngle,
        tolerance: rule.tolerance,
        movement: toMovement(rule.movement),
        startingPosition: rule.startingPosition,
        targetPosition: rule.targetPosition,
        holdDurationSeconds: rule.holdDurationSeconds,
      }),
    ),
  }));
}

export async function generateExercises(
  jobId: string,
): Promise<{ plan: GenerateExercisesResponse; exercises: Exercise[] }> {
  // Analysis is loaded server-side from the stored job result; omit the body so we do not
  // send a partial analysis payload (e.g. missing affectedSide from GET /analysis).
  const plan = await apiFetch<GenerateExercisesResponse>(`/api/jobs/${jobId}/exercises`, {
    method: 'POST',
  });

  if (!plan.exercises || plan.exercises.length === 0) {
    throw new Error('No exercises were returned for this analysis.');
  }

  return {
    plan,
    exercises: plan.exercises.map(mapExerciseFromApi),
  };
}
