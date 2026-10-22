import { useMemo } from 'react';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { BodyExplorerViewer } from '../../bodyExplorer/BodyExplorerViewer';
import { hedgedLikelihood } from '../../utils/copy';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const mirrorControlButtonClass =
  'h-auto min-h-9 rounded-lg border border-black bg-white px-4 py-1.5 text-sm font-medium text-black shadow-none hover:bg-neutral-50';

export function SmartMirrorResultsScreen() {
  const { state, dispatch } = useWorkflow();
  const analysis = state.analysis;

  const selectedMeshes = useMemo(() => {
    if (!analysis || state.selectedMuscleIndex === null) return [];
    const muscle = analysis.muscles[state.selectedMuscleIndex];
    if (!muscle) return [];
    return muscle.bodyExplorerMeshNames ?? (muscle.bodyExplorerId ? [muscle.bodyExplorerId] : []);
  }, [analysis, state.selectedMuscleIndex]);

  const allHighlightMeshes = useMemo(() => {
    if (!analysis) return [];
    const names = new Set<string>();
    for (const muscle of analysis.muscles) {
      for (const name of muscle.bodyExplorerMeshNames ?? []) names.add(name);
      if (muscle.bodyExplorerId) names.add(muscle.bodyExplorerId);
    }
    return [...names];
  }, [analysis]);

  const highlightMeshes = selectedMeshes.length > 0 ? selectedMeshes : allHighlightMeshes;
  const isolateSelected = state.selectedMuscleIndex !== null && selectedMeshes.length > 0;

  const returnHome = () => {
    dispatch({ type: 'SET_SELECTED_MUSCLE', index: null });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_home' });
  };

  return (
    <MirrorPortraitCard testId="mirror-results-card">
      <div className="flex min-h-0 flex-1 flex-col p-5 sm:p-6">
        <div className="mb-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-results-home"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorControlButtonClass)}
            onClick={returnHome}
          >
            Home
          </Button>
        </div>

        {!analysis ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-neutral-300">
            Loading results…
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <header className="shrink-0 text-center">
              <h1 className="text-lg font-semibold text-white">Results</h1>
              <p className="mt-2 text-sm leading-relaxed text-neutral-200">{analysis.summary}</p>
              <p className="mt-2 text-xs text-neutral-400">
                {analysis.bodyRegion} · {analysis.observedDeformation}
              </p>
            </header>

            <div
              data-testid="mirror-muscle-skeleton"
              className="flex min-h-[280px] min-w-0 flex-[1.35] flex-col"
            >
              <BodyExplorerViewer
                handControl
                className="body-explorer-canvas min-h-[280px] flex-1"
                highlightMeshNames={highlightMeshes}
                isolateSelected={isolateSelected}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {analysis.muscles.length === 0 ? (
                <p className="text-center text-sm text-neutral-300">
                  No muscle findings were returned for this scan.
                </p>
              ) : (
                <ul className="space-y-3">
                  {analysis.muscles.map((muscle, index) => (
                    <li
                      key={`${muscle.name}-${muscle.side}-${index}`}
                      className="rounded-xl border border-white/20 bg-black px-3 py-2.5 text-left"
                    >
                      <p className="font-medium text-white">{muscle.name}</p>
                      <p className="text-xs text-neutral-300">{hedgedLikelihood(muscle.likelihood)}</p>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-400">{muscle.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="shrink-0 text-center text-[10px] leading-snug text-neutral-400">
              Educational information only — not a medical diagnosis.
            </p>
          </div>
        )}
      </div>
    </MirrorPortraitCard>
  );
}
