import { useEffect, useRef } from 'react';
import { getAnalysis, getJob, getModel } from '../api/jobs';
import { isMirrorJobFlow } from '../workflow/mirrorJobFlow';
import { useWorkflow } from '../workflow/WorkflowContext';
import type { WorkflowError, WorkflowStage, WorkflowState } from '../workflow/types';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function retryStageAfterJob(state: WorkflowState): WorkflowStage {
  if (isMirrorJobFlow(state)) return 'mirror_analysis';
  if (state.scanId) return 'scan_detail';
  return 'patient_detail';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function processingFailureError(state: WorkflowState, technical?: string): WorkflowError {
  const mirrorFlow = isMirrorJobFlow(state);
  return {
    title: 'Processing failed',
    message: mirrorFlow
      ? 'Analysis could not be completed. You can try another capture from the analysis screen.'
      : 'Something went wrong while processing this scan. You can retry from the scan details screen.',
    technical,
    retryStage: retryStageAfterJob(state),
    retryKind: 'job',
  };
}

function analysisLoadFailureError(state: WorkflowState, technical?: string): WorkflowError {
  const mirrorFlow = isMirrorJobFlow(state);
  return {
    title: 'Results unavailable',
    message: mirrorFlow
      ? 'Analysis finished but the results could not be loaded. You can try another capture from the analysis screen.'
      : 'Analysis finished but the results could not be loaded. You can retry from the scan details screen.',
    technical,
    retryStage: retryStageAfterJob(state),
    retryKind: 'recapture',
  };
}

/** Stages where a finished job should open results or the error screen immediately. */
function presentsJobOutcome(stage: WorkflowStage): boolean {
  return stage === 'mirror_processing' || stage === 'mirror_uploading' || stage === 'processing';
}

interface JobOutcome {
  stage: WorkflowStage;
  error?: WorkflowError;
}

export function useJobPolling(active: boolean) {
  const { state, dispatch } = useWorkflow();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // A job that settled while the patient was elsewhere; shown when they return to its progress page.
  const pendingOutcomeRef = useRef<{ jobId: string; outcome: JobOutcome } | null>(null);

  useEffect(() => {
    if (!active || !state.jobId) return;

    const jobId = state.jobId;

    const present = (outcome: JobOutcome) => {
      if (outcome.error) dispatch({ type: 'SET_ERROR', error: outcome.error });
      dispatch({ type: 'SET_STAGE', stage: outcome.stage });
    };

    // Reads the stage after the awaits, so leaving mid-poll does not drag the patient back.
    const settle = (outcome: JobOutcome) => {
      const latest = stateRef.current;
      if (latest.jobId !== jobId) return;
      if (presentsJobOutcome(latest.stage)) {
        pendingOutcomeRef.current = null;
        present(outcome);
      } else {
        pendingOutcomeRef.current = { jobId, outcome };
      }
    };

    const poll = async () => {
      const current = stateRef.current;
      try {
        const status = await getJob(jobId);
        dispatch({ type: 'SET_JOB_STATUS', status });

        if (status.status === 'COMPLETED') {
          try {
            const analysis = await getAnalysis(jobId);
            dispatch({ type: 'SET_ANALYSIS', analysis });

            if (!isMirrorJobFlow(current)) {
              let riggedGlbUrl: string | null = null;
              try {
                const model = await getModel(jobId);
                riggedGlbUrl = model.riggedGlbUrl ?? null;
              } catch (modelErr) {
                console.error('Model fetch failed:', modelErr);
              }
              dispatch({ type: 'SET_RIGGED_URL', url: riggedGlbUrl });
            }

            settle({ stage: current.jobCompleteStage });
          } catch (err) {
            console.error('Analysis fetch failed:', err);
            settle({ stage: 'error', error: analysisLoadFailureError(current, errorText(err)) });
          }
        } else if (status.status === 'FAILED') {
          settle({ stage: 'error', error: processingFailureError(current, status.error ?? undefined) });
        }
      } catch (err) {
        console.error('Job polling error:', err);
      }
    };

    void poll();
    timerRef.current = setInterval(poll, 3000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active, state.jobCompleteStage, state.jobId, state.scanId, dispatch]);

  useEffect(() => {
    if (!state.jobStatus) return;
    if (TERMINAL.has(state.jobStatus.status)) {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [state.jobStatus]);

  useEffect(() => {
    const pending = pendingOutcomeRef.current;
    if (!pending) return;
    if (pending.jobId !== state.jobId) {
      pendingOutcomeRef.current = null;
      return;
    }
    if (!presentsJobOutcome(state.stage)) return;
    pendingOutcomeRef.current = null;
    if (pending.outcome.error) dispatch({ type: 'SET_ERROR', error: pending.outcome.error });
    dispatch({ type: 'SET_STAGE', stage: pending.outcome.stage });
  }, [dispatch, state.jobId, state.stage]);
}
