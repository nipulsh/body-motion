import { z } from 'zod';

export const muscleSideSchema = z.enum(['left', 'right', 'bilateral', 'midline', 'unknown']);

export const bodyRegionSchema = z.enum([
  'head_neck',
  'shoulder',
  'upper_arm_elbow',
  'forearm_hand',
  'chest',
  'upper_back',
  'lower_back',
  'abdomen',
  'pelvis_hip',
  'thigh',
  'knee',
  'lower_leg_ankle',
  'foot',
]);

/** One entry of the mandatory head-to-toe check, so no region is skipped or assumed. */
export const regionAssessmentSchema = z.object({
  region: bodyRegionSchema,
  side: muscleSideSchema,
  /** 0 = nothing notable, 1 = pronounced deviation. */
  severity: z.number().min(0).max(1),
  observation: z.string().min(1),
});

/** One postural deviation or body-shape change. A region can hold several. */
export const deformitySchema = z.object({
  name: z.string().min(1),
  region: bodyRegionSchema,
  side: muscleSideSchema,
  /** 0 = barely present, 1 = pronounced. */
  severity: z.number().min(0).max(1),
  description: z.string().min(1),
});

const muscleBase = {
  name: z.string().min(1),
  side: muscleSideSchema,
  likelihood: z.number().min(0).max(1),
  deformation: z.string().min(1),
  intensity: z.number().min(0).max(1),
  reason: z.string().min(1),
};

/** Strict shape requested from Gemini. */
export const geminiMuscleResponseSchema = z.object({
  ...muscleBase,
  /** Body region (from the assessment) this muscle explains. */
  region: bodyRegionSchema,
  /** Share of the observed deformity attributed to this muscle; all muscles sum to 100. */
  contributionPercent: z.number().min(0).max(100),
});

export const geminiAnalysisResponseSchema = z.object({
  /** False when clothing, framing or image quality stop the body being judged. The rest then stays empty. */
  analysisPossible: z.boolean(),
  regionAssessment: z.array(regionAssessmentSchema),
  deformities: z.array(deformitySchema),
  bodyRegion: z.string().min(1),
  observedDeformation: z.string().min(1),
  affectedSide: muscleSideSchema,
  summary: z.string().min(1),
  // No upper bound: every plausibly contributing muscle is returned.
  muscles: z.array(geminiMuscleResponseSchema),
});

/**
 * Stored / served analysis. New fields are optional so analyses saved before they existed
 * still parse.
 */
export const geminiMuscleSchema = z.object({
  ...muscleBase,
  region: bodyRegionSchema.optional(),
  contributionPercent: z.number().min(0).max(100).optional(),
});

export const geminiAnalysisSchema = z.object({
  /** False when the capture could not be analysed; `summary` says why. Absent on older analyses. */
  analysisPossible: z.boolean().optional(),
  regionAssessment: z.array(regionAssessmentSchema).optional(),
  deformities: z.array(deformitySchema).optional(),
  /** Set when the model kept ignoring the strongest measured deviation after a correction. */
  measurementConflict: z.string().optional(),
  /** Names the model returned that are not in the muscle catalogue; dropped from `muscles`. */
  invalidMuscleNames: z.array(z.string()).optional(),
  bodyRegion: z.string().min(1),
  observedDeformation: z.string().min(1),
  affectedSide: muscleSideSchema,
  summary: z.string().min(1),
  /** Empty only when `analysisPossible` is false. */
  muscles: z.array(geminiMuscleSchema),
});

export type Deformity = z.infer<typeof deformitySchema>;
export type GeminiAnalysisResponse = z.infer<typeof geminiAnalysisResponseSchema>;
export type GeminiAnalysis = z.infer<typeof geminiAnalysisSchema>;
export type GeminiMuscle = z.infer<typeof geminiMuscleSchema>;
export type MuscleSide = z.infer<typeof muscleSideSchema>;
export type BodyRegion = z.infer<typeof bodyRegionSchema>;
