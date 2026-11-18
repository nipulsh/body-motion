import { useMemo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import type { Exercise } from '@vision';
import { BodyExplorerViewer } from '../../bodyExplorer/BodyExplorerViewer';
import { hedgedLikelihood } from '../../utils/copy';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { mirrorGestureButtonClass, mirrorGestureListItemClass, mirrorGestureListItemSelectedClass } from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { DEMO_ANALYSIS, demoSuggestedExercises } from '../analysis/demoAnalysis';
import { analysisWasPossible, DeformityList } from '../analysis/DeformityList';
import { FindingNumber, MuscleContribution, MuscleModelNote } from '../analysis/MuscleContribution';
import { useAnalysisMuscleView } from '../analysis/useAnalysisMuscleView';
import {
  SUGGESTED_EXERCISE_ATTR,
  SuggestedExerciseList,
  SuggestedExerciseOverview,
  useSuggestedExercises,
  type SuggestedExercisesView,
} from '../analysis/SuggestedExercises';

function jumpLabel(view: SuggestedExercisesView): string {
  if (view.status === 'loading') return 'Suggested exercises · preparing';
  if (view.status === 'ready') return `Suggested exercises (${view.exercises.length})`;
  return 'Suggested exercises';
}

/** `demo` shows the bundled sample analysis and plan instead of the patient's own result. */
export function SmartMirrorResultsScreen({ demo = false }: { demo?: boolean }) {
  const { state, dispatch } = useWorkflow();
  const analysis = demo ? DEMO_ANALYSIS : state.analysis;

  const muscleView = useAnalysisMuscleView(analysis, state.selectedMuscleIndex);
  const selectMuscle = (index: number | null) => dispatch({ type: 'SET_SELECTED_MUSCLE', index });

  const canSuggest = !demo && analysis != null && analysisWasPossible(analysis);
  const jobSuggestions = useSuggestedExercises(canSuggest ? (state.jobId ?? null) : null);
  const demoPlan = useMemo<SuggestedExercisesView | null>(
    () => (demo ? { status: 'ready', exercises: demoSuggestedExercises() } : null),
    [demo],
  );
  const suggestions = demoPlan ? { view: demoPlan, retry: jobSuggestions.retry } : jobSuggestions;
  const hasSuggestions = suggestions.view.status !== 'idle';
  const scrollRef = useRef<HTMLDivElement>(null);
  const exercisesRef = useRef<HTMLElement>(null);

  const returnHome = () => {
    dispatch({ type: 'SET_SELECTED_MUSCLE', index: null });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_home' });
  };

  /** Scrolls to the exercise list, or to one exercise's card when `index` is given. */
  const showExercises = (index?: number) => {
    const container = scrollRef.current;
    const section = exercisesRef.current;
    if (!container || !section) return;
    const card =
      index === undefined
        ? null
        : section.querySelector<HTMLElement>(`[${SUGGESTED_EXERCISE_ATTR}="${index}"]`);
    const target = card ?? section;
    const top = target.offsetTop;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      container.scrollTop = top;
    }
    card?.focus({ preventScroll: true });
  };

  const startSuggested = (exercises: Exercise[], index: number) => {
    dispatch({ type: 'SET_EXERCISES', exercises });
    dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: demo ? 'mirror_demo_results' : 'mirror_results' });
    dispatch({ type: 'SET_EXERCISE_INDEX', index });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_exercise_session' });
  };

  return (
    <MirrorPortraitCard testId="mirror-results-card">
      <div className="flex min-h-0 flex-1 flex-col p-5 sm:p-6">
        <div className="mb-5 flex justify-end sm:mb-6">
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-results-home"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureButtonClass)}
            onClick={returnHome}
          >
            Home
          </Button>
        </div>

        {!analysis ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-neutral-300">
            Loading results…
          </div>
        ) : !analysisWasPossible(analysis) ? (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
            data-testid="mirror-analysis-not-possible"
          >
            <h1 className="text-lg font-semibold text-white">This scan could not be analysed</h1>
            <p className="text-sm leading-relaxed text-neutral-200">{analysis.summary}</p>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
            data-testid="mirror-results-scroll"
          >
            {/* The analysis fills the first screen; the suggested exercises start just below it. */}
            <div
              className={cn(
                'flex min-h-0 flex-col gap-3 overflow-hidden',
                hasSuggestions ? 'h-[calc(100%-5.5rem)]' : 'h-full',
              )}
              data-testid="mirror-results-analysis"
            >
              <header className="shrink-0">
                <h1 className="text-lg font-semibold text-white" data-testid="mirror-results-title">
                  {demo ? 'Sample results' : 'Results'}
                </h1>
                <p className="mt-1 text-sm leading-relaxed text-neutral-200">{analysis.summary}</p>
                <p className="mt-1 text-xs text-neutral-400">
                  {analysis.bodyRegion} · {analysis.observedDeformation}
                </p>
                <SuggestedExerciseOverview
                  view={suggestions.view}
                  onSelect={(index) => showExercises(index)}
                  className="mt-3"
                />
              </header>

              <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
                <div className="flex min-h-0 w-[46%] flex-col overflow-y-auto pr-1" data-testid="mirror-muscle-list">
                  <DeformityList deformities={analysis.deformities} tone="mirror" className="mb-4" />
                  {analysis.muscles.length === 0 ? (
                    <p className="text-sm text-neutral-300">No muscle findings were returned for this scan.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {analysis.muscles.map((muscle, index) => {
                        const selected = state.selectedMuscleIndex === index;
                        return (
                          <li key={`${muscle.name}-${muscle.side}-${index}`}>
                            <button
                              type="button"
                              data-testid={`mirror-muscle-${index}`}
                              aria-pressed={selected}
                              {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                              className={cn(
                                mirrorGestureListItemClass,
                                selected && mirrorGestureListItemSelectedClass,
                              )}
                              onClick={() => selectMuscle(index)}
                            >
                              <p className="flex items-center gap-2 font-medium text-white">
                                <FindingNumber number={index + 1} tone="mirror" />
                                <span>
                                  {muscle.name}
                                  <span className="font-normal text-neutral-300"> · {muscle.side}</span>
                                </span>
                              </p>
                              <p className="text-xs text-neutral-300">{hedgedLikelihood(muscle.likelihood)}</p>
                              <MuscleContribution percent={muscle.contributionPercent} tone="mirror" />
                              <MuscleModelNote muscle={muscle} tone="mirror" />
                              <p className="mt-1 text-xs leading-relaxed text-neutral-400">{muscle.reason}</p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div
                  data-testid="mirror-muscle-skeleton"
                  className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                  <BodyExplorerViewer
                    handControl
                    className="body-explorer-canvas min-h-0 flex-1"
                    highlightMeshNames={muscleView.highlightMeshes}
                    isolateSelected={muscleView.isolateSelected}
                    markers={muscleView.markers}
                    selectedMarkerIndex={state.selectedMuscleIndex}
                    focusMeshNames={muscleView.focusMeshNames}
                    onMarkerSelect={selectMuscle}
                    onResetView={() => selectMuscle(null)}
                  />
                </div>
              </div>

              <p className="shrink-0 text-center text-[10px] leading-snug text-neutral-400">
                Educational information only — not a medical diagnosis.
              </p>
            </div>

            {hasSuggestions ? (
              <>
                <button
                  type="button"
                  data-testid="mirror-results-show-exercises"
                  {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                  className={cn(
                    mirrorGestureListItemClass,
                    'mt-4 flex min-h-16 items-center justify-center gap-2 text-base font-semibold text-white',
                  )}
                  onClick={() => showExercises()}
                >
                  {jumpLabel(suggestions.view)}
                  <ChevronDown aria-hidden="true" className="size-5" />
                </button>
                <SuggestedExerciseList
                  ref={exercisesRef}
                  view={suggestions.view}
                  onRetry={suggestions.retry}
                  onStart={startSuggested}
                  className="pt-6 pb-8"
                />
              </>
            ) : null}
          </div>
        )}
      </div>
    </MirrorPortraitCard>
  );
}
