/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryJob } from '../../api/jobs';
import { INITIAL_WORKFLOW_STATE, type WorkflowError, type WorkflowState } from '../../workflow/types';
import { ErrorScreen } from './ErrorScreen';

const stopScan = vi.hoisted(() => vi.fn());
const workflow = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {} as WorkflowState,
}));

vi.mock('@vision', () => ({
  getVisionManager: () => ({ stopScan }),
}));

vi.mock('../../api/jobs', () => ({
  retryJob: vi.fn(),
}));

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({ dispatch: workflow.dispatch, state: workflow.state }),
}));

function errorState(error: WorkflowError, jobId: string | null = 'job-1'): WorkflowState {
  return {
    ...INITIAL_WORKFLOW_STATE,
    stage: 'error',
    jobId,
    jobCompleteStage: 'mirror_results',
    error,
  };
}

describe('ErrorScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    workflow.dispatch.mockClear();
    stopScan.mockClear();
    vi.mocked(retryJob).mockReset();
    vi.mocked(retryJob).mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function renderScreen() {
    act(() => {
      root.render(<ErrorScreen />);
    });
  }

  function click(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === label,
    );
    if (!button) throw new Error(`missing ${label} button`);
    act(() => {
      button.click();
    });
  }

  async function clickRetry() {
    const button = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === 'Retry',
    );
    if (!button) throw new Error('missing Retry button');
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
  }

  it.each(['Upload failed', 'Not enough images', 'Too many images', 'Upload unavailable'])(
    'recaptures %s instead of retrying a stored job',
    async (title) => {
      workflow.state = errorState({
        title,
        message: 'Try the capture again.',
        retryStage: 'mirror_analysis',
      });
      renderScreen();

      await clickRetry();

      expect(retryJob).not.toHaveBeenCalled();
      expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'CLEAR_JOB' });
      expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'RESET_CAPTURES' });
      expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_ERROR', error: null });
      expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_analysis' });
      expect(stopScan).toHaveBeenCalled();
    },
  );

  it('does not treat an error title as a processing failure', async () => {
    workflow.state = errorState({
      title: 'Processing failed',
      message: 'The title alone is not a job retry.',
      retryStage: 'mirror_analysis',
    });
    renderScreen();

    await clickRetry();

    expect(retryJob).not.toHaveBeenCalled();
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'CLEAR_JOB' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_analysis' });
  });

  it('retries only a failed processing job', async () => {
    workflow.state = errorState({
      title: 'Processing failed',
      message: 'Analysis could not be completed.',
      retryStage: 'mirror_analysis',
      retryKind: 'job',
    });
    renderScreen();

    await clickRetry();

    expect(retryJob).toHaveBeenCalledWith('job-1');
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_ERROR', error: null });
    expect(workflow.dispatch).toHaveBeenCalledWith({
      type: 'SET_STAGE',
      stage: 'mirror_processing',
    });
    expect(workflow.dispatch).not.toHaveBeenCalledWith({ type: 'CLEAR_JOB' });
    expect(stopScan).not.toHaveBeenCalled();
  });

  it('clears the job when leaving an upload error for home', () => {
    workflow.state = errorState({
      title: 'Upload failed',
      message: 'Network error.',
      retryStage: 'mirror_analysis',
    });
    renderScreen();

    click('Home');

    expect(retryJob).not.toHaveBeenCalled();
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'CLEAR_JOB' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'RESET_CAPTURES' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_ERROR', error: null });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_home' });
    expect(stopScan).toHaveBeenCalled();
  });

  it('clears a failed processing job when Home is chosen', () => {
    workflow.state = errorState({
      title: 'Processing failed',
      message: 'Analysis could not be completed.',
      retryKind: 'job',
    });
    renderScreen();

    click('Home');

    expect(retryJob).not.toHaveBeenCalled();
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'CLEAR_JOB' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_home' });
  });
});
