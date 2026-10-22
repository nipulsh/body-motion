import { formatJobStatusLabel } from '../../utils/copy';
import { useJobPolling } from '../../hooks/useJobPolling';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { PageHeader } from '../layout/PageHeader';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import { cn } from '@/lib/utils';

function stageDone(status: string, steps: string[]): boolean {
  const order = [
    'QUEUED',
    'ANALYZING',
    'GENERATING_IMAGES',
    'CREATING_3D_MODEL',
    'RIGGING',
    'COMPLETED',
  ];
  const idx = order.indexOf(status);
  const stepIdx = order.indexOf(steps[steps.length - 1]);
  return idx > stepIdx;
}

function stageActive(status: string, stepStatuses: string[]): boolean {
  return stepStatuses.includes(status);
}

export function ProcessingScreen() {
  const { state } = useWorkflow();
  useJobPolling(true);

  const status = state.jobStatus?.status ?? 'QUEUED';
  const progress = state.jobStatus?.progress ?? 0;

  const muscleSteps = ['QUEUED', 'ANALYZING', 'GENERATING_IMAGES'];
  const modelSteps = ['CREATING_3D_MODEL', 'RIGGING'];

  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageHeader
        title="Processing"
        description="This may take several minutes. You can leave this screen open."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card
          className={cn(
            stageActive(status, muscleSteps) && 'border-primary',
            stageDone(status, muscleSteps) && 'border-chart-2',
          )}
        >
          <CardHeader>
            <CardTitle>Muscle analysis</CardTitle>
            <CardDescription>
              Gemini reviews your scan and maps likely muscle involvement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={stageDone(status, muscleSteps) ? 'secondary' : 'default'}>
              {formatJobStatusLabel(status)}
            </Badge>
          </CardContent>
        </Card>
        <Card
          className={cn(
            stageActive(status, modelSteps) && 'border-primary',
            stageDone(status, modelSteps) && 'border-chart-2',
          )}
        >
          <CardHeader>
            <CardTitle>Personalized 3D model</CardTitle>
            <CardDescription>Reference views and Meshy rigging build your avatar.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={stageDone(status, modelSteps) ? 'secondary' : 'default'}>
              {stageDone(status, modelSteps) ? 'Complete' : formatJobStatusLabel(status)}
            </Badge>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Progress value={progress} className="h-3" />
          <p className="text-sm text-muted-foreground">
            {state.jobStatus?.currentStep ?? 'Starting pipeline…'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
