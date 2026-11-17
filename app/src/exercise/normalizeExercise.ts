import { applyRepAngleRanges, type Exercise, type ExerciseFormCheck, type TrackingRule } from '@vision';

function normalizeRule(rule: TrackingRule): TrackingRule {
  const tolerance = Math.max(rule.tolerance, 10);
  const startTolerance = Math.max(tolerance, 12);

  const start = rule.startAngle;
  const required = rule.requiredAngle;
  const minAngle = Math.min(rule.minimumAngle, start - startTolerance, required - tolerance);
  const maxAngle = Math.max(rule.maximumAngle, start + startTolerance, required + tolerance);

  return {
    ...rule,
    tolerance,
    minimumAngle: Math.max(0, Math.min(minAngle, 180)),
    maximumAngle: Math.min(180, Math.max(maxAngle, 0)),
    /** Dynamic reps: brief Gemini holds often block rep completion in live camera use. */
    holdDurationSeconds: 0,
  };
}

/** Plan exercises come from the server without `formCheck`; recognise them by name. */
function inferFormCheck(exercise: Exercise): ExerciseFormCheck | undefined {
  if (exercise.formCheck) return exercise.formCheck;
  if (exercise.modality === 'hand_trace') return undefined;
  // "Split squat" is a lunge pattern: one lead leg, so it gets the lunge check.
  if (/\blunges?\b|\bsplit squats?\b/i.test(exercise.name)) return 'lunge';
  if (/\bsquats?\b/i.test(exercise.name)) return 'squat';
  if (/\bdead\s?lifts?\b/i.test(exercise.name)) return 'deadlift';
  if (/\bshoulder (abduction|flexion)\b|\b(lateral|front) raises?\b/i.test(exercise.name)) return 'shoulder';
  return undefined;
}

/**
 * Tune API/Gemini exercises for reliable live rep detection. Exercises recognised by id or
 * name get the start/target windows from `vision/exercise/repAngleRanges.ts`.
 */
export function normalizeExercise(exercise: Exercise): Exercise {
  const trackingRules = exercise.trackingRules.map(normalizeRule);
  const formCheck = inferFormCheck(exercise);
  return applyRepAngleRanges({
    ...exercise,
    ...(formCheck ? { formCheck } : {}),
    recommendedReps: Math.max(1, exercise.recommendedReps),
    sets: Math.max(1, exercise.sets),
    trackingRules: trackingRules.length > 0 ? trackingRules : exercise.trackingRules,
  });
}

export function normalizeExercises(exercises: Exercise[]): Exercise[] {
  return exercises.map(normalizeExercise);
}
