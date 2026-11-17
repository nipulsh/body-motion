import { z } from 'zod';

/**
 * Joints that the vision pipeline can derive angles for (MediaPipe landmark triplets).
 * snake_case names map to future `vision/pose` angle calculators.
 */
export const trackableJointSchema = z.enum([
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'neck',
  'spine',
]);

export const movementDirectionSchema = z.enum([
  'flexion',
  'extension',
  'abduction',
  'adduction',
  'internal_rotation',
  'external_rotation',
  'elevation',
  'depression',
]);

export const exerciseDifficultySchema = z.enum(['beginner', 'intermediate', 'advanced']);

export const trackingRuleSchema = z
  .object({
    joint: trackableJointSchema,
    /** Angle at the start of the rep (degrees, 0–180). */
    startAngle: z.number().min(0).max(180),
    /** Required angle the patient must reach at end of concentric phase (degrees, 0–180). */
    requiredAngle: z.number().min(0).max(180),
    /** Lower bound of acceptable angle range during the movement. */
    minimumAngle: z.number().min(0).max(180),
    /** Upper bound of acceptable angle range during the movement. */
    maximumAngle: z.number().min(0).max(180),
    /** Acceptable deviation from requiredAngle (degrees). */
    tolerance: z.number().min(0).max(45),
    movement: movementDirectionSchema,
    startingPosition: z.string().min(1),
    targetPosition: z.string().min(1),
    holdDurationSeconds: z.number().min(0).max(120).optional(),
  })
  .refine((rule) => rule.minimumAngle <= rule.maximumAngle, {
    message: 'minimumAngle must be less than or equal to maximumAngle',
    path: ['minimumAngle'],
  })
  .refine(
    (rule) => rule.requiredAngle >= rule.minimumAngle && rule.requiredAngle <= rule.maximumAngle,
    {
      message: 'requiredAngle must fall within minimumAngle and maximumAngle',
      path: ['requiredAngle'],
    },
  );

export const exerciseSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'id must be lowercase alphanumeric with underscores or hyphens'),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  targetBodyParts: z.array(z.string().min(1)).min(1).max(8),
  difficulty: exerciseDifficultySchema,
  sets: z.number().int().min(1).max(10),
  recommendedReps: z.number().int().min(1).max(50),
  restSeconds: z.number().int().min(0).max(600),
  instructions: z.array(z.string().min(1)).min(1).max(12),
  safetyNotes: z.array(z.string().min(1)).min(1).max(8),
  trackingRules: z.array(trackingRuleSchema).min(1).max(6),
});

export const exercisePlanSchema = z
  .object({
    exercises: z.array(exerciseSchema).min(5).max(6),
  })
  .refine(
    (plan) => {
      const ids = plan.exercises.map((exercise) => exercise.id);
      return new Set(ids).size === ids.length;
    },
    { message: 'exercise ids must be unique', path: ['exercises'] },
  );

/** Optional body when generating from a client-supplied analysis payload. */
export const exerciseGenerationRequestSchema = z.object({
  analysis: z
    .object({
      bodyRegion: z.string().min(1),
      observedDeformation: z.string().min(1),
      affectedSide: z.enum(['left', 'right', 'bilateral', 'midline', 'unknown']),
      summary: z.string().min(1),
      muscles: z
        .array(
          z.object({
            name: z.string().min(1),
            side: z.enum(['left', 'right', 'bilateral', 'midline', 'unknown']),
            likelihood: z.number().min(0).max(1),
            deformation: z.string().min(1),
            intensity: z.number().min(0).max(1),
            reason: z.string().min(1),
            contributionPercent: z.number().min(0).max(100).optional(),
          }),
        )
        .min(1),
    })
    .optional(),
});

export type TrackableJoint = z.infer<typeof trackableJointSchema>;
export type MovementDirection = z.infer<typeof movementDirectionSchema>;
export type ExerciseDifficulty = z.infer<typeof exerciseDifficultySchema>;
export type TrackingRule = z.infer<typeof trackingRuleSchema>;
export type Exercise = z.infer<typeof exerciseSchema>;
export type ExercisePlan = z.infer<typeof exercisePlanSchema>;
export type ExerciseGenerationRequest = z.infer<typeof exerciseGenerationRequestSchema>;
