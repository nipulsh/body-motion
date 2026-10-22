import { useEffect, useRef } from 'react';
import { targetCaptureCount } from '@vision';
import { describeUploadFailure } from '../api/client';
import { createPatient } from '../api/patients';
import { createScan, processScan, uploadScanImages } from '../api/scans';
import { useRequiresOnline } from './useRequiresOnline';
import { OFFLINE_ACTION_MESSAGE } from '../offline/messages';
import { useWorkflow } from '../workflow/WorkflowContext';
import type { WorkflowStage } from '../workflow/types';

export interface ScanUploadPipelineOptions {
  retryStage: WorkflowStage;
  processingStage: WorkflowStage;
}

export function useScanUploadPipeline({ retryStage, processingStage }: ScanUploadPipelineOptions) {
  const { state, dispatch } = useWorkflow();
  const { isOnline } = useRequiresOnline();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;

    if (!isOnline) {
      started.current = true;
      dispatch({
        type: 'SET_ERROR',
        error: {
          title: 'Upload unavailable',
          message: OFFLINE_ACTION_MESSAGE,
          retryStage,
        },
      });
      dispatch({ type: 'SET_STAGE', stage: 'error' });
      return;
    }

    const expected = targetCaptureCount(state.scanCaptureMode);
    const minImages = state.scanCaptureMode === 'TIMED_BURST' ? 80 : 30;
    const maxImages = state.scanCaptureMode === 'TIMED_BURST' ? 80 : 40;
    if (state.capturedImages.length < minImages) {
      dispatch({
        type: 'SET_ERROR',
        error: {
          title: 'Not enough images',
          message:
            state.scanCaptureMode === 'TIMED_BURST'
              ? `We need ${expected} frames; only ${state.capturedImages.length} were captured.`
              : `We need at least 30 angles; only ${state.capturedImages.length} were captured.`,
          retryStage,
        },
      });
      dispatch({ type: 'SET_STAGE', stage: 'error' });
      return;
    }
    if (state.capturedImages.length > maxImages) {
      dispatch({
        type: 'SET_ERROR',
        error: {
          title: 'Too many images',
          message: `This scan produced ${state.capturedImages.length} images; the limit is ${maxImages}. Retry capture.`,
          retryStage,
        },
      });
      dispatch({ type: 'SET_STAGE', stage: 'error' });
      return;
    }
    started.current = true;

    const run = async () => {
      try {
        let patientId = state.patientId;
        let patientName = state.patientName;
        if (!patientId || patientId === 'pending') {
          if (!patientName?.trim()) {
            throw new Error('Select a patient before uploading a scan.');
          }
          const [firstName, ...rest] = patientName.trim().split(/\s+/);
          const created = await createPatient({
            firstName: firstName || 'Patient',
            lastName: rest.join(' ') || 'Unknown',
          });
          patientId = created.patient.id;
          patientName = created.patient.fullName;
          dispatch({
            type: 'SET_PATIENT',
            patientId,
            name: patientName,
            patient: created.patient,
          });
        }

        let scanId = state.scanId;
        if (!scanId) {
          const scanType = state.scanCaptureMode === 'TIMED_BURST' ? 'TIMED_BURST' : 'BODY_360';
          const createdScan = await createScan(patientId, scanType);
          scanId = createdScan.scanId;
          dispatch({ type: 'SET_SCAN', scanId });
        }

        dispatch({ type: 'SET_UPLOAD_PROGRESS', percent: 0 });
        await uploadScanImages(
          scanId,
          state.capturedImages.map((c) => ({ blob: c.blob, angleDeg: c.angleDeg })),
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            dispatch({ type: 'SET_UPLOAD_PROGRESS', percent: pct });
          },
        );

        const processing = await processScan(scanId);
        dispatch({ type: 'SET_JOB', jobId: processing.jobId });
        dispatch({ type: 'SET_STAGE', stage: processingStage });
      } catch (err) {
        console.error('[UPLOAD] FAILED', err);
        const { message, technical } = describeUploadFailure(err);
        dispatch({
          type: 'SET_ERROR',
          error: {
            title: 'Upload failed',
            message,
            technical,
            retryStage,
          },
        });
        dispatch({ type: 'SET_STAGE', stage: 'error' });
      }
    };

    void run();
  }, [
    dispatch,
    isOnline,
    processingStage,
    retryStage,
    state.capturedImages,
    state.patientId,
    state.patientName,
    state.scanCaptureMode,
    state.scanId,
  ]);
}
