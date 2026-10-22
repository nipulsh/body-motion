import { useEffect } from 'react';
import { getVisionManager } from '@vision';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { retryJob } from '../../api/jobs';
import { mirrorProcessingStage, shouldRetryJob } from '../../workflow/mirrorJobFlow';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const mirrorControlButtonClass =
  'h-auto min-h-9 rounded-lg border border-black bg-white px-4 py-1.5 text-sm font-medium text-black shadow-none hover:bg-neutral-50';

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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-lg font-semibold text-white">{err.title}</h1>
          <p className="text-sm leading-relaxed text-neutral-200 whitespace-pre-line">{err.message}</p>
          {err.technical ? (
            <p className="text-xs break-all text-neutral-400">{err.technical}</p>
          ) : null}
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorControlButtonClass)}
            onClick={() => void retry()}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="outline"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorControlButtonClass)}
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
