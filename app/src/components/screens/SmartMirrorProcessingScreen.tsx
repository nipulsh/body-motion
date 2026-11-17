import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { formatJobStatusLabel } from '../../utils/copy';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { mirrorGestureButtonClass } from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneFillClass } from '../smartMirror/mirrorTopZone';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { cn } from '@/lib/utils';

export function SmartMirrorProcessingScreen() {
  const { state, dispatch } = useWorkflow();

  const status = state.jobStatus?.status ?? 'QUEUED';
  const progress = state.jobStatus?.progress ?? 0;
  const step = state.jobStatus?.currentStep ?? 'Starting analysis…';

  return (
    <MirrorPortraitCard testId="mirror-processing-card">
      <div className={cn('flex min-h-0 flex-col p-6 sm:p-8', mirrorTopZoneFillClass)}>
        <div className="flex justify-start">
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-processing-home"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureButtonClass)}
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'mirror_home' })}
          >
            Back to home
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center-safe gap-6 pt-4 text-center">
          <p className="text-lg font-medium text-white">Analysing</p>
          <p className="text-sm text-neutral-300">{formatJobStatusLabel(status)}</p>
          <div className="w-full max-w-[14rem] space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-neutral-400">{step}</p>
          </div>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
