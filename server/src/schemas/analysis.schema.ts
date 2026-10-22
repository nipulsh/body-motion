import { z } from 'zod';

export const muscleSideSchema = z.enum(['left', 'right', 'bilateral', 'midline', 'unknown']);

export const geminiMuscleSchema = z.object({
  name: z.string().min(1),
  side: muscleSideSchema,
  likelihood: z.number().min(0).max(1),
  deformation: z.string().min(1),
  intensity: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const geminiAnalysisSchema = z.object({
  bodyRegion: z.string().min(1),
  observedDeformation: z.string().min(1),
  affectedSide: muscleSideSchema,
  summary: z.string().min(1),
  muscles: z.array(geminiMuscleSchema).min(1),
});

export type GeminiAnalysis = z.infer<typeof geminiAnalysisSchema>;
export type GeminiMuscle = z.infer<typeof geminiMuscleSchema>;
export type MuscleSide = z.infer<typeof muscleSideSchema>;
