import { useJobPolling } from '../../hooks/useJobPolling';
import { formatJobStatusLabel } from '../../utils/copy';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Progress } from '../ui/progress';

export function SmartMirrorProcessingScreen() {
  const { state } = useWorkflow();
  useJobPolling(true);

  const status = state.jobStatus?.status ?? 'QUEUED';
  const progress = state.jobStatus?.progress ?? 0;
  const step = state.jobStatus?.currentStep ?? 'Starting analysis…';

  return (
    <MirrorPortraitCard testId="mirror-processing-card">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <p className="text-lg font-medium text-white">Analysing</p>
        <p className="text-sm text-neutral-300">{formatJobStatusLabel(status)}</p>
        <div className="w-full max-w-[14rem] space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-neutral-400">{step}</p>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
