import type { Exercise, TrackingRule } from '@vision';

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

/** Tune API/Gemini exercises for reliable live rep detection. */
export function normalizeExercise(exercise: Exercise): Exercise {
  const trackingRules = exercise.trackingRules.map(normalizeRule);
  return {
    ...exercise,
    recommendedReps: Math.max(1, exercise.recommendedReps),
    sets: Math.max(1, exercise.sets),
    trackingRules: trackingRules.length > 0 ? trackingRules : exercise.trackingRules,
  };
}

export function normalizeExercises(exercises: Exercise[]): Exercise[] {
  return exercises.map(normalizeExercise);
}
