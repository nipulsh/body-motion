import { toJSONSchema } from 'zod';
import { z } from 'zod';

/**
 * Loose JSON schema for Gemini structured output only.
 *
 * Gemini rejects the full `exercisePlanSchema` JSON schema when the plan
 * requires multiple exercises with nested tracking rules (INVALID_ARGUMENT).
 * Response text is still validated with `exercisePlanSchema` after generation.
 */
const geminiTrackingRuleSchema = z.object({
  joint: z.string(),
  startAngle: z.number(),
  requiredAngle: z.number(),
  minimumAngle: z.number(),
  maximumAngle: z.number(),
  tolerance: z.number(),
  movement: z.string(),
  startingPosition: z.string(),
  targetPosition: z.string(),
  holdDurationSeconds: z.number().optional(),
});

const geminiExerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  targetBodyParts: z.array(z.string()),
  difficulty: z.string(),
  sets: z.number(),
  recommendedReps: z.number(),
  restSeconds: z.number(),
  instructions: z.array(z.string()),
  safetyNotes: z.array(z.string()),
  trackingRules: z.array(geminiTrackingRuleSchema),
});

export const geminiExercisePlanResponseSchema = z.object({
  exercises: z.array(geminiExerciseSchema).min(5).max(6),
});

export function getGeminiExercisePlanJsonSchema() {
  return toJSONSchema(geminiExercisePlanResponseSchema);
}
