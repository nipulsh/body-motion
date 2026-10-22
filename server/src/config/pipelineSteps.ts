import type { PipelineStep } from '@prisma/client';
import { PIPELINE_STEPS } from './constants';
import { env } from './env';

export function pipelineStepsForJob(): readonly PipelineStep[] {
  if (env.meshyEnabled) {
    return PIPELINE_STEPS;
  }
  return PIPELINE_STEPS.filter(
    (step) =>
      step !== 'IMAGE_GENERATION' && step !== 'MODEL_GENERATION' && step !== 'RIGGING',
  );
}
