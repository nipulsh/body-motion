import type { Exercise } from '../../schemas/exercise.schema';

export function buildExerciseDemoVideoPrompt(exercise: Exercise): string {
  const rules = exercise.trackingRules
    .map(
      (rule, index) =>
        `${index + 1}. ${rule.joint} — ${rule.movement}: ${rule.startingPosition} → ${rule.targetPosition}`,
    )
    .join('\n');

  return [
    'Generate a physiotherapy exercise demonstration clip featuring a single neutral 3D anatomical human character (not a real person photograph).',
    'Match the appearance of the provided reference image when one is supplied.',
    'STATIC front-facing camera, full body visible head to toe, no camera motion, no zoom, no orbit.',
    'Animate only the movement required for this exercise — slow, clinical, controlled tempo.',
    'Plain dark studio background. No text, logos, UI, or props.',
    'Seamless loop: start and end in the same pose.',
    'No audio.',
    '',
    `Exercise: ${exercise.name}`,
    exercise.description,
    '',
    'Steps:',
    ...exercise.instructions.map((step, i) => `${i + 1}. ${step}`),
    '',
    'Joint motion to depict:',
    rules,
  ].join('\n');
}
