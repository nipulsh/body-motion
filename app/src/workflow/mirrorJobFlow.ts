import type { WorkflowError, WorkflowStage, WorkflowState } from './types';

export function isMirrorJobFlow(state: WorkflowState): boolean {
  return state.jobCompleteStage === 'mirror_results';
}

export function mirrorProcessingStage(state: WorkflowState): WorkflowStage {
  return isMirrorJobFlow(state) ? 'mirror_processing' : 'processing';
}

/** Job retry is only for a failed processing job. Upload and capture errors recapture. */
export function shouldRetryJob(error: WorkflowError | null | undefined): boolean {
  return error?.retryKind === 'job';
}
