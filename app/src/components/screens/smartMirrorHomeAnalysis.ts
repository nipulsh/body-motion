const SETTLED_JOB = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export interface MirrorAnalysisHomeState {
  jobId: string | null;
  jobStatus: { status: string } | null;
  analysis: unknown | null;
}

/** A submitted analysis job that has not finished, failed, or been cancelled. */
export function isMirrorAnalysisRunning(state: MirrorAnalysisHomeState): boolean {
  if (!state.jobId) return false;
  if (!state.jobStatus) return true;
  return !SETTLED_JOB.has(state.jobStatus.status);
}

/**
 * One home control: the running job while analysis is in progress,
 * otherwise the latest finished result. A job that failed, or finished without
 * loaded results, reopens its progress page so the outcome is shown there.
 */
export function mirrorHomeReviewTarget(state: MirrorAnalysisHomeState): 'progress' | 'results' | null {
  if (isMirrorAnalysisRunning(state)) return 'progress';
  if (state.analysis) return 'results';
  if (state.jobId && (state.jobStatus?.status === 'FAILED' || state.jobStatus?.status === 'COMPLETED')) {
    return 'progress';
  }
  return null;
}
