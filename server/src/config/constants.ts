import type { GeneratedImageView, JobStatus, PipelineStep } from '@prisma/client';

export const MIN_JOB_IMAGES = 30;
export const MAX_JOB_IMAGES = 40;
/** Per-image upload cap for scan/job image batches (15 MiB). */
export const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const ALLOWED_MODEL_MIME_TYPES = ['model/gltf-binary', 'application/octet-stream'] as const;
export type AllowedModelMimeType = (typeof ALLOWED_MODEL_MIME_TYPES)[number];
export const ALLOWED_MODEL_EXTENSIONS = ['glb'] as const;

export const GENERATED_IMAGE_VIEWS = ['FRONT', 'RIGHT', 'BACK', 'LEFT'] as const satisfies readonly GeneratedImageView[];

export const PIPELINE_STEPS = [
  'ANALYSIS',
  'IMAGE_GENERATION',
  'MODEL_GENERATION',
  'RIGGING',
] as const satisfies readonly PipelineStep[];

/** Progress written when a stage begins and when it completes. */
export const STEP_PROGRESS: Record<PipelineStep, { start: number; end: number }> = {
  ANALYSIS: { start: 5, end: 25 },
  IMAGE_GENERATION: { start: 25, end: 50 },
  MODEL_GENERATION: { start: 50, end: 80 },
  RIGGING: { start: 80, end: 99 },
};

export const STEP_STATUS: Record<PipelineStep, JobStatus> = {
  ANALYSIS: 'ANALYZING',
  IMAGE_GENERATION: 'GENERATING_IMAGES',
  MODEL_GENERATION: 'CREATING_3D_MODEL',
  RIGGING: 'RIGGING',
};

/** Snake-case labels returned by `GET /api/jobs/:jobId` as `currentStep`. */
export const STEP_CURRENT_LABEL: Record<PipelineStep, string> = {
  ANALYSIS: 'analyzing_patient_images',
  IMAGE_GENERATION: 'generating_reference_images',
  MODEL_GENERATION: 'creating_3d_model',
  RIGGING: 'rigging_model',
};

export const VIEW_TO_API: Record<GeneratedImageView, 'front' | 'right' | 'back' | 'left'> = {
  FRONT: 'front',
  RIGHT: 'right',
  BACK: 'back',
  LEFT: 'left',
};

export const API_VIEW_ORDER: GeneratedImageView[] = ['FRONT', 'RIGHT', 'BACK', 'LEFT'];
