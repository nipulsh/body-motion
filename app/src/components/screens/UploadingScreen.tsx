import { useWorkflow } from '../../workflow/WorkflowContext';
import { useScanUploadPipeline } from '../../hooks/useScanUploadPipeline';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Progress } from '../ui/progress';

export function UploadingScreen() {
  const { state } = useWorkflow();
  useScanUploadPipeline({ retryStage: 'camera_setup', processingStage: 'processing' });

  return (
    <div className="mx-auto max-w-2xl p-8">
      <PageHeader
        title="Uploading scan"
        description={`Securely sending ${state.capturedImages.length} images and starting processing…`}
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Progress value={state.uploadProgress} className="h-3" />
          <p className="text-3xl font-semibold tracking-tight">{state.uploadProgress}%</p>
        </CardContent>
      </Card>
    </div>
  );
}
