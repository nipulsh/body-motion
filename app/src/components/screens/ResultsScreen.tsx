import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { BodyExplorerViewer } from '../../bodyExplorer/BodyExplorerViewer';
import { RiggedModelViewer } from '../../bodyExplorer/RiggedModelViewer';
import { hedgedLikelihood } from '../../utils/copy';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { PageHeader } from '../layout/PageHeader';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  FindingNumber,
  MeasurementConflictNotice,
  MuscleContribution,
  MuscleModelNote,
} from '../analysis/MuscleContribution';
import { analysisWasPossible, DeformityList } from '../analysis/DeformityList';
import { useAnalysisMuscleView } from '../analysis/useAnalysisMuscleView';

type ExpandedPanel = 'anatomy' | 'model' | null;

function PanelExpandButton({
  expanded,
  label,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-slot="card-action"
      className="col-start-2 row-span-2 row-start-1 size-8 shrink-0 justify-self-end self-start"
      aria-label={expanded ? `Shrink ${label}` : `Fullscreen ${label}`}
      onClick={onToggle}
    >
      {expanded ? <Minimize2 /> : <Maximize2 />}
    </Button>
  );
}

export function ResultsScreen() {
  const { state, dispatch } = useWorkflow();
  const analysis = state.analysis;
  const [expanded, setExpanded] = useState<ExpandedPanel>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const muscleView = useAnalysisMuscleView(analysis, state.selectedMuscleIndex);
  const selectMuscle = (index: number | null) => dispatch({ type: 'SET_SELECTED_MUSCLE', index });

  if (!analysis) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Loading results…</p>
      </div>
    );
  }

  if (!analysisWasPossible(analysis)) {
    return (
      <div className="p-8">
        <PageHeader title={`Results — ${state.patientName}`} />
        <Card className="max-w-2xl" data-testid="analysis-not-possible">
          <CardHeader>
            <CardTitle className="text-base">This scan could not be analysed</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <p className="text-sm">{analysis.summary}</p>
            <Button type="button" variant="outline" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'dashboard' })}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <PageHeader
        title={`Results — ${state.patientName}`}
        description={
          <>
            {analysis.summary}
            <span className="mt-1 block text-muted-foreground">
              {analysis.bodyRegion} · {analysis.observedDeformation}
            </span>
            <span className="mt-2 block">
              <MeasurementConflictNotice conflict={analysis.measurementConflict} />
            </span>
          </>
        }
      />
      <div className="grid min-h-[480px] gap-4 xl:grid-cols-[1fr_1fr_320px]">
        <div className={cn(expanded === 'anatomy' && 'min-h-[420px]')}>
          <Card
            className={cn(
              'h-full overflow-hidden py-0',
              expanded === 'anatomy' &&
                'fixed inset-3 z-50 flex flex-col shadow-2xl',
            )}
          >
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-base">Anatomy map</CardTitle>
              <CardDescription>
                Click a number to zoom to that muscle and hide the others. Reset returns to the
                full body.
              </CardDescription>
              <PanelExpandButton
                expanded={expanded === 'anatomy'}
                label="anatomy map"
                onToggle={() =>
                  setExpanded((current) => (current === 'anatomy' ? null : 'anatomy'))
                }
              />
            </CardHeader>
            <CardContent
              className={cn(
                'flex min-h-[360px] flex-1 flex-col px-6 pb-6',
                expanded === 'anatomy' && 'min-h-0',
              )}
            >
              <BodyExplorerViewer
                className={cn(
                  'body-explorer-canvas',
                  expanded === 'anatomy' && 'min-h-0',
                )}
                highlightMeshNames={muscleView.highlightMeshes}
                isolateSelected={muscleView.isolateSelected}
                markers={muscleView.markers}
                selectedMarkerIndex={state.selectedMuscleIndex}
                focusMeshNames={muscleView.focusMeshNames}
                onMarkerSelect={selectMuscle}
                onResetView={() => selectMuscle(null)}
              />
            </CardContent>
          </Card>
        </div>
        <div className={cn(expanded === 'model' && 'min-h-[420px]')}>
          <Card
            className={cn(
              'h-full overflow-hidden py-0',
              expanded === 'model' && 'fixed inset-3 z-50 flex flex-col shadow-2xl',
            )}
          >
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-base">Your 3D model</CardTitle>
              <PanelExpandButton
                expanded={expanded === 'model'}
                label="3D model"
                onToggle={() =>
                  setExpanded((current) => (current === 'model' ? null : 'model'))
                }
              />
            </CardHeader>
            <CardContent
              className={cn(
                'flex min-h-[360px] flex-1 flex-col px-6 pb-6',
                expanded === 'model' && 'min-h-0',
              )}
            >
              <RiggedModelViewer
                className={cn('rigged-canvas', expanded === 'model' && 'min-h-0')}
                glbUrl={state.riggedGlbUrl}
              />
            </CardContent>
          </Card>
        </div>
        <Card className="py-0">
          <CardHeader className="px-6 pt-6">
            <CardTitle className="text-base">Findings</CardTitle>
            <CardDescription>
              These suggestions are educational and not a diagnosis. Clinical judgment is required.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 px-6 pb-6">
            <ScrollArea className="h-[55vh] pr-3">
              <DeformityList deformities={analysis.deformities} className="mb-4" />
              <h2 className="mb-2 text-sm font-semibold">Contributing muscles ({analysis.muscles.length})</h2>
              <ul className="space-y-2">
                {analysis.muscles.map((muscle, index) => (
                  <li key={`${muscle.name}-${index}`}>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-lg border bg-background/60 px-3 py-3 text-left transition-colors hover:bg-accent',
                        state.selectedMuscleIndex === index && 'border-primary ring-1 ring-primary',
                      )}
                      onClick={() => selectMuscle(index)}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <FindingNumber number={index + 1} />
                        {muscle.name}
                      </span>
                      <span className="block text-sm text-primary">
                        {hedgedLikelihood(muscle.likelihood)}
                      </span>
                      <MuscleContribution percent={muscle.contributionPercent} />
                      <MuscleModelNote muscle={muscle} />
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {muscle.reason}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={!state.jobId}
              onClick={() => {
                dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: 'results' });
                dispatch({ type: 'SET_STAGE', stage: 'exercise_loading' });
              }}
            >
              Start exercises
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'dashboard' })}
            >
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
