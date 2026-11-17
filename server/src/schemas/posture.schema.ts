import { z } from 'zod';

/**
 * Mirrors `vision/pose/postureMetrics.ts` (PostureMetricsSummary). The client measures these
 * from MediaPipe landmarks on the scan frames; every angle is a joint angle or taken against
 * the body's own up axis, so camera tilt does not move it.
 */
export const postureMuscleGroupSchema = z.enum([
  'HEAD_NECK',
  'SHOULDER',
  'UPPER_ARM',
  'FOREARM',
  'CHEST',
  'BACK',
  'ABDOMEN',
  'HIP',
  'UPPER_LEG',
  'LOWER_LEG',
]);

export const postureFindingSchema = z.object({
  region: z.enum(['head_neck', 'shoulder', 'elbow', 'trunk', 'pelvis_hip', 'knee', 'leg']),
  side: z.enum(['left', 'right', 'bilateral', 'midline']),
  metric: z.string().min(1).max(64),
  value: z.number().finite(),
  unit: z.enum(['deg', 'percent']),
  threshold: z.number().positive(),
  severity: z.number().min(0).max(1000),
  muscleGroups: z.array(postureMuscleGroupSchema).max(10),
  description: z.string().min(1).max(300),
});

export const postureMetricsSchema = z.object({
  version: z.literal(1),
  frameCount: z.number().int().min(0),
  frontalFrames: z.number().int().min(0),
  sideFrames: z.number().int().min(0),
  metrics: z.record(z.string().max(64), z.number().finite()),
  findings: z.array(postureFindingSchema).max(40),
});

export type PostureMetrics = z.infer<typeof postureMetricsSchema>;
export type PostureFinding = z.infer<typeof postureFindingSchema>;
