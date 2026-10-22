import { useEffect, useMemo, useState } from 'react';
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

  const selectedMeshes = useMemo(() => {
    if (!analysis || state.selectedMuscleIndex === null) return [];
    const m = analysis.muscles[state.selectedMuscleIndex];
    if (!m) return [];
    return m.bodyExplorerMeshNames ?? (m.bodyExplorerId ? [m.bodyExplorerId] : []);
  }, [analysis, state.selectedMuscleIndex]);

  const allHighlightMeshes = useMemo(() => {
    if (!analysis) return [];
    const names = new Set<string>();
    for (const m of analysis.muscles) {
      for (const n of m.bodyExplorerMeshNames ?? []) names.add(n);
      if (m.bodyExplorerId) names.add(m.bodyExplorerId);
    }
    return [...names];
  }, [analysis]);

  const highlightMeshes =
    selectedMeshes.length > 0 ? selectedMeshes : allHighlightMeshes;
  const isolateSelected = state.selectedMuscleIndex !== null && selectedMeshes.length > 0;

  if (!analysis) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Loading results…</p>
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
                Select a finding to highlight that muscle and hide surrounding muscles.
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
                highlightMeshNames={highlightMeshes}
                isolateSelected={isolateSelected}
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
              <ul className="space-y-2">
                {analysis.muscles.map((muscle, index) => (
                  <li key={`${muscle.name}-${index}`}>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-lg border bg-background/60 px-3 py-3 text-left transition-colors hover:bg-accent',
                        state.selectedMuscleIndex === index && 'border-primary ring-1 ring-primary',
                      )}
                      onClick={() => dispatch({ type: 'SET_SELECTED_MUSCLE', index })}
                    >
                      <span className="block font-medium">{muscle.name}</span>
                      <span className="block text-sm text-primary">
                        {hedgedLikelihood(muscle.likelihood)}
                      </span>
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
