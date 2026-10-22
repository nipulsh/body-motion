import { useWorkflow } from '../../workflow/WorkflowContext';
import { useScanUploadPipeline } from '../../hooks/useScanUploadPipeline';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Progress } from '../ui/progress';

export function SmartMirrorUploadingScreen() {
  const { state } = useWorkflow();
  useScanUploadPipeline({ retryStage: 'mirror_analysis', processingStage: 'mirror_processing' });

  return (
    <MirrorPortraitCard testId="mirror-upload-card">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <p className="text-lg font-medium text-white">Uploading scan</p>
        <p className="text-sm text-neutral-300">
          Sending {state.capturedImages.length} frames securely…
        </p>
        <div className="w-full max-w-[14rem] space-y-2">
          <Progress value={state.uploadProgress} className="h-2" />
          <p className="text-2xl font-semibold text-white">{state.uploadProgress}%</p>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
