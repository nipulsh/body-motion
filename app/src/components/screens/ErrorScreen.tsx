import { useEffect } from 'react';
import { getVisionManager } from '@vision';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { retryJob } from '../../api/jobs';
import { mirrorProcessingStage, shouldRetryJob } from '../../workflow/mirrorJobFlow';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { mirrorGestureButtonStackClass, mirrorGestureMenuButtonClass } from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneFillClass } from '../smartMirror/mirrorTopZone';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

export function ErrorScreen() {
  const { state, dispatch } = useWorkflow();
  const err = state.error;
  const fallbackStage = 'mirror_home';

  useEffect(() => {
    if (!err) {
      dispatch({ type: 'SET_STAGE', stage: fallbackStage });
    }
  }, [dispatch, err, fallbackStage]);

  if (!err) return null;

  const retry = async () => {
    if (shouldRetryJob(err) && state.jobId) {
      try {
        await retryJob(state.jobId);
        // Clears the FAILED status so the retried job is polled again.
        dispatch({ type: 'SET_JOB', jobId: state.jobId });
        dispatch({ type: 'SET_ERROR', error: null });
        dispatch({ type: 'SET_STAGE', stage: mirrorProcessingStage(state) });
        return;
      } catch (e) {
        console.error(e);
      }
    }
    dispatch({ type: 'CLEAR_JOB' });
    dispatch({ type: 'RESET_CAPTURES' });
    dispatch({ type: 'SET_ERROR', error: null });
    getVisionManager().stopScan();
    dispatch({ type: 'SET_STAGE', stage: err.retryStage ?? 'mirror_home' });
  };

  return (
    <MirrorPortraitCard testId="mirror-error-card">
      <div className={cn('flex min-h-0 flex-col items-center justify-center-safe gap-8 p-8 text-center', mirrorTopZoneFillClass)}>
        <div className="max-w-md space-y-3">
          <h1 className="text-lg font-semibold text-white">{err.title}</h1>
          <p className="text-sm leading-relaxed text-neutral-200 whitespace-pre-line">{err.message}</p>
          {err.technical ? (
            <p className="text-xs break-all text-neutral-400">{err.technical}</p>
          ) : null}
        </div>
        <div className={cn(mirrorGestureButtonStackClass, 'items-center px-4')}>
          <Button
            type="button"
            variant="outline"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureMenuButtonClass)}
            onClick={() => void retry()}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="outline"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureMenuButtonClass)}
            onClick={() => {
              dispatch({ type: 'RESET_CAPTURES' });
              dispatch({ type: 'CLEAR_JOB' });
              dispatch({ type: 'SET_ERROR', error: null });
              getVisionManager().stopScan();
              dispatch({ type: 'SET_STAGE', stage: fallbackStage });
            }}
          >
            Home
          </Button>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
