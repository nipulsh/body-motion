import { describe, expect, it } from 'vitest';
import type { JobStatusResponse } from '../api/types';
import { INITIAL_WORKFLOW_STATE, workflowReducer } from './types';
import { isMirrorJobFlow, mirrorProcessingStage, shouldRetryJob } from './mirrorJobFlow';

describe('mirrorJobFlow', () => {
  it('detects mirror results completion target', () => {
    expect(isMirrorJobFlow(INITIAL_WORKFLOW_STATE)).toBe(true);
    expect(
      isMirrorJobFlow({ ...INITIAL_WORKFLOW_STATE, jobCompleteStage: 'results' }),
    ).toBe(false);
  });

  it('routes processing stage for mirror flow', () => {
    expect(mirrorProcessingStage(INITIAL_WORKFLOW_STATE)).toBe('mirror_processing');
    expect(
      mirrorProcessingStage({ ...INITIAL_WORKFLOW_STATE, jobCompleteStage: 'results' }),
    ).toBe('processing');
  });

  it('retries a job only after a processing failure', () => {
    expect(
      shouldRetryJob({
        title: 'Processing failed',
        message: 'Analysis could not be completed.',
        retryKind: 'job',
        retryStage: 'mirror_analysis',
      }),
    ).toBe(true);
    expect(shouldRetryJob({ title: 'Processing failed', message: 'title is not the signal' })).toBe(
      false,
    );
    for (const title of [
      'Upload failed',
      'Not enough images',
      'Too many images',
      'Upload unavailable',
    ]) {
      expect(shouldRetryJob({ title, message: 'Recapture.', retryStage: 'mirror_analysis' })).toBe(
        false,
      );
    }
    expect(
      shouldRetryJob({
        title: 'Results unavailable',
        message: 'Analysis finished but the results could not be loaded.',
        retryKind: 'recapture',
      }),
    ).toBe(false);
    expect(shouldRetryJob(null)).toBe(false);
  });

  it('clears the stored job without resetting the capture session', () => {
    const jobStatus: JobStatusResponse = {
      jobId: 'job-1',
      patientId: 'patient-1',
      status: 'FAILED',
      progress: 40,
      currentStep: 'ANALYSIS',
      error: 'pipeline failed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const next = workflowReducer(
      {
        ...INITIAL_WORKFLOW_STATE,
        patientId: 'patient-1',
        scanId: 'scan-1',
        jobId: 'job-1',
        jobStatus,
        capturedImages: [{ blob: new Blob(['frame']), angleDeg: 0, timestamp: 1 }],
      },
      { type: 'CLEAR_JOB' },
    );
    expect(next.jobId).toBeNull();
    expect(next.jobStatus).toBeNull();
    expect(next.patientId).toBe('patient-1');
    expect(next.scanId).toBe('scan-1');
    expect(next.capturedImages).toHaveLength(1);
  });
});
