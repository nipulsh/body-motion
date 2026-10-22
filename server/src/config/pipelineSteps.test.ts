import { afterEach, describe, expect, it } from 'vitest';
import { env } from './env';
import { pipelineStepsForJob } from './pipelineSteps';
import { determineStartStep } from '../services/jobs/jobPipeline.service';
import type { JobWithRelations } from '../repositories/job.repository';

const originalMeshyEnabled = env.meshyEnabled;

afterEach(() => {
  (env as { meshyEnabled: boolean }).meshyEnabled = originalMeshyEnabled;
});

function setMeshyEnabled(enabled: boolean): void {
  (env as { meshyEnabled: boolean }).meshyEnabled = enabled;
}

function pipelineJob(options: {
  hasAnalysis: boolean;
  generatedImageCount?: number;
  meshyJobs?: JobWithRelations['meshyJobs'];
}): JobWithRelations {
  return {
    analysisResult: options.hasAnalysis ? { id: 'analysis' } : null,
    generatedImages: Array.from({ length: options.generatedImageCount ?? 0 }, () => ({})),
    meshyJobs: options.meshyJobs ?? [],
    scan: { type: 'TIMED_BURST' },
  } as JobWithRelations;
}

describe('pipelineStepsForJob', () => {
  it('stops after analysis when Meshy is off', () => {
    setMeshyEnabled(false);
    expect(pipelineStepsForJob()).toEqual(['ANALYSIS']);
  });

  it('keeps image generation, model generation, and rigging when Meshy is on', () => {
    setMeshyEnabled(true);
    expect(pipelineStepsForJob()).toEqual([
      'ANALYSIS',
      'IMAGE_GENERATION',
      'MODEL_GENERATION',
      'RIGGING',
    ]);
  });
});

describe('determineStartStep', () => {
  it('starts at analysis when no analysis result exists', () => {
    setMeshyEnabled(false);
    expect(determineStartStep(pipelineJob({ hasAnalysis: false }))).toBe('ANALYSIS');

    setMeshyEnabled(true);
    expect(determineStartStep(pipelineJob({ hasAnalysis: false }))).toBe('ANALYSIS');
  });

  it('finishes once analysis exists when Meshy is off', () => {
    setMeshyEnabled(false);
    expect(
      determineStartStep(pipelineJob({ hasAnalysis: true, generatedImageCount: 0 })),
    ).toBeNull();
    expect(
      determineStartStep(pipelineJob({ hasAnalysis: true, generatedImageCount: 2 })),
    ).toBeNull();
  });

  it('continues through images, the model, and rigging when Meshy is on', () => {
    setMeshyEnabled(true);
    expect(
      determineStartStep(pipelineJob({ hasAnalysis: true, generatedImageCount: 2 })),
    ).toBe('IMAGE_GENERATION');
    expect(
      determineStartStep(pipelineJob({ hasAnalysis: true, generatedImageCount: 4 })),
    ).toBe('MODEL_GENERATION');
    expect(
      determineStartStep(
        pipelineJob({
          hasAnalysis: true,
          generatedImageCount: 4,
          meshyJobs: [
            { kind: 'MULTI_IMAGE_TO_3D', status: 'SUCCEEDED', storagePath: 'model.glb' },
          ] as JobWithRelations['meshyJobs'],
        }),
      ),
    ).toBe('RIGGING');
    expect(
      determineStartStep(
        pipelineJob({
          hasAnalysis: true,
          generatedImageCount: 4,
          meshyJobs: [
            { kind: 'MULTI_IMAGE_TO_3D', status: 'SUCCEEDED', storagePath: 'model.glb' },
            { kind: 'RIGGING', status: 'SUCCEEDED', storagePath: 'rigged.glb' },
          ] as JobWithRelations['meshyJobs'],
        }),
      ),
    ).toBeNull();
  });
});
