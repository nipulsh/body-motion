/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnalysis, getJob, getModel } from '../api/jobs';
import type { AnalysisResponse, JobStatusResponse, ModelResponse } from '../api/types';
import { INITIAL_WORKFLOW_STATE, type WorkflowState } from '../workflow/types';
import { useJobPolling } from './useJobPolling';

const workflow = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {} as WorkflowState,
}));

vi.mock('../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({ dispatch: workflow.dispatch, state: workflow.state }),
}));

vi.mock('../api/jobs', () => ({
  getJob: vi.fn(),
  getAnalysis: vi.fn(),
  getModel: vi.fn(),
}));

const analysis: AnalysisResponse = {
  bodyRegion: 'Upper body',
  observedDeformation: 'Mild',
  affectedSide: 'bilateral',
  summary: 'Shoulder elevation differs between sides.',
  muscles: [],
};

function jobStatus(status: string, error: string | null = null): JobStatusResponse {
  return {
    jobId: 'job-1',
    patientId: 'patient-1',
    status,
    progress: status === 'COMPLETED' ? 100 : 40,
    currentStep: null,
    error,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function Harness() {
  useJobPolling(true);
  return null;
}

describe('useJobPolling', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    workflow.dispatch.mockClear();
    vi.mocked(getJob).mockReset();
    vi.mocked(getAnalysis).mockReset();
    vi.mocked(getModel).mockReset();
    workflow.state = {
      ...INITIAL_WORKFLOW_STATE,
      stage: 'mirror_processing',
      jobId: 'job-1',
      scanId: 'scan-1',
      jobCompleteStage: 'mirror_results',
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderPolling() {
    await act(async () => {
      root.render(<Harness />);
    });
  }

  it('opens mirror results from analysis alone and does not fetch the model', async () => {
    vi.mocked(getJob).mockResolvedValue(jobStatus('COMPLETED'));
    vi.mocked(getAnalysis).mockResolvedValue(analysis);
    vi.mocked(getModel).mockImplementation(() => new Promise<ModelResponse>(() => {}));

    await renderPolling();

    expect(getAnalysis).toHaveBeenCalledWith('job-1');
    expect(getModel).not.toHaveBeenCalled();
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_ANALYSIS', analysis });
    expect(workflow.dispatch).toHaveBeenCalledWith({
      type: 'SET_STAGE',
      stage: 'mirror_results',
    });
    expect(workflow.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_RIGGED_URL' }),
    );
  });

  it('sends a failed analysis load to the error screen', async () => {
    vi.mocked(getJob).mockResolvedValue(jobStatus('COMPLETED'));
    vi.mocked(getAnalysis).mockRejectedValue(new Error('analysis missing'));

    await renderPolling();

    expect(getModel).not.toHaveBeenCalled();
    expect(workflow.dispatch).toHaveBeenCalledWith({
      type: 'SET_ERROR',
      error: expect.objectContaining({
        title: 'Results unavailable',
        technical: 'analysis missing',
        retryStage: 'mirror_analysis',
        retryKind: 'recapture',
      }),
    });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'error' });
    expect(workflow.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_STAGE', stage: 'mirror_results' }),
    );
  });

  it('keeps polling when the status request fails', async () => {
    vi.mocked(getJob).mockRejectedValue(new Error('network'));

    await renderPolling();

    expect(workflow.dispatch).not.toHaveBeenCalled();
    expect(getAnalysis).not.toHaveBeenCalled();
  });

  it('marks a failed processing job so retry can resume it', async () => {
    vi.mocked(getJob).mockResolvedValue(jobStatus('FAILED', 'pipeline exploded'));

    await renderPolling();

    expect(getAnalysis).not.toHaveBeenCalled();
    expect(getModel).not.toHaveBeenCalled();
    expect(workflow.dispatch).toHaveBeenCalledWith({
      type: 'SET_ERROR',
      error: expect.objectContaining({
        title: 'Processing failed',
        technical: 'pipeline exploded',
        retryStage: 'mirror_analysis',
        retryKind: 'job',
      }),
    });
  });

  it('keeps the current screen when analysis finishes away from the progress page', async () => {
    workflow.state = {
      ...workflow.state,
      stage: 'mirror_home',
    };
    vi.mocked(getJob).mockResolvedValue(jobStatus('COMPLETED'));
    vi.mocked(getAnalysis).mockResolvedValue(analysis);

    await renderPolling();

    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_ANALYSIS', analysis });
    expect(workflow.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_STAGE' }),
    );
  });

  it('shows clinical results when the model url is null', async () => {
    workflow.state = {
      ...workflow.state,
      stage: 'processing',
      jobCompleteStage: 'results',
    };
    vi.mocked(getJob).mockResolvedValue(jobStatus('COMPLETED'));
    vi.mocked(getAnalysis).mockResolvedValue(analysis);
    vi.mocked(getModel).mockResolvedValue({ glbUrl: null, riggedGlbUrl: null });

    await renderPolling();

    expect(getModel).toHaveBeenCalledWith('job-1');
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_ANALYSIS', analysis });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_RIGGED_URL', url: null });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'results' });
  });

  it('shows clinical analysis when the model request fails', async () => {
    workflow.state = {
      ...workflow.state,
      stage: 'processing',
      jobCompleteStage: 'results',
      scanId: null,
    };
    vi.mocked(getJob).mockResolvedValue(jobStatus('COMPLETED'));
    vi.mocked(getAnalysis).mockResolvedValue(analysis);
    vi.mocked(getModel).mockRejectedValue(new Error('model down'));

    await renderPolling();

    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_ANALYSIS', analysis });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_RIGGED_URL', url: null });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'results' });
    expect(workflow.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_ERROR' }),
    );
  });

  it('sends a clinical analysis load failure to the scan or patient screen', async () => {
    workflow.state = {
      ...workflow.state,
      jobCompleteStage: 'results',
      scanId: 'scan-9',
    };
    vi.mocked(getJob).mockResolvedValue(jobStatus('COMPLETED'));
    vi.mocked(getAnalysis).mockRejectedValue(new Error('missing'));

    await renderPolling();

    expect(getModel).not.toHaveBeenCalled();
    expect(workflow.dispatch).toHaveBeenCalledWith({
      type: 'SET_ERROR',
      error: expect.objectContaining({
        retryKind: 'recapture',
        retryStage: 'scan_detail',
      }),
    });
  });
});
