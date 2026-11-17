import { forwardRef, useCallback, useEffect, useState } from 'react';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import type { Exercise } from '@vision';
import { cachedSuggestedExercises, loadSuggestedExercises } from '../../exercise/suggestedExercises';
import { cn } from '../../lib/utils';
import { mirrorGestureButtonClass, mirrorGestureListItemClass } from '../smartMirror/mirrorGestureButton';
import { Button } from '../ui/button';

export type SuggestedExercisesView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; exercises: Exercise[] }
  | { status: 'error' };

type Stored = SuggestedExercisesView & { jobId: string | null };

function initialView(jobId: string | null): Stored {
  if (!jobId) return { status: 'idle', jobId };
  const cached = cachedSuggestedExercises(jobId);
  return cached ? { status: 'ready', exercises: cached, jobId } : { status: 'loading', jobId };
}

/** AI exercise plan for the analysis job. Pass `null` while there is nothing to plan from. */
export function useSuggestedExercises(jobId: string | null): {
  view: SuggestedExercisesView;
  retry: () => void;
} {
  const [stored, setStored] = useState<Stored>(() => initialView(jobId));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!jobId) {
      setStored({ status: 'idle', jobId });
      return;
    }
    const cached = cachedSuggestedExercises(jobId);
    if (cached) {
      setStored({ status: 'ready', exercises: cached, jobId });
      return;
    }

    let cancelled = false;
    setStored({ status: 'loading', jobId });
    loadSuggestedExercises(jobId).then(
      (exercises) => {
        if (!cancelled) setStored({ status: 'ready', exercises, jobId });
      },
      (error: unknown) => {
        if (import.meta.env.DEV) console.error('[SuggestedExercises] could not load the plan', error);
        if (!cancelled) setStored({ status: 'error', jobId });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [jobId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // A plan for a different job must never show, even for the one render before the effect runs.
  const view: SuggestedExercisesView =
    stored.jobId === jobId ? stored : jobId ? { status: 'loading' } : { status: 'idle' };
  return { view, retry };
}

const DIFFICULTY_LABELS: Record<Exercise['difficulty'], string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Beginner · 3 sets × 10 reps · 30 s rest" */
export function exerciseDoseLabel(exercise: Exercise): string {
  const parts = [DIFFICULTY_LABELS[exercise.difficulty] ?? exercise.difficulty];
  if (exercise.modality !== 'hand_trace') {
    parts.push(`${plural(exercise.sets, 'set', 'sets')} × ${plural(exercise.recommendedReps, 'rep', 'reps')}`);
  }
  if (exercise.restSeconds > 0) parts.push(`${exercise.restSeconds} s rest`);
  return parts.join(' · ');
}

/** Marks each exercise card so the overview can scroll to it. */
export const SUGGESTED_EXERCISE_ATTR = 'data-suggested-exercise';

interface SuggestedExerciseOverviewProps {
  view: SuggestedExercisesView;
  /** Opens the full card (how to do it, safety notes, Start) for that exercise. */
  onSelect: (index: number) => void;
  className?: string;
}

/** The AI exercise plan named inside the analysis overview, so the patient sees it without scrolling. */
export function SuggestedExerciseOverview({ view, onSelect, className }: SuggestedExerciseOverviewProps) {
  if (view.status === 'idle') return null;

  return (
    <div data-testid="mirror-overview-exercises" className={cn('flex flex-col gap-2', className)}>
      <h2 className="text-sm font-semibold text-white">Suggested exercises</h2>

      {view.status === 'loading' ? (
        <p role="status" className="text-xs leading-relaxed text-neutral-300" data-testid="mirror-overview-exercises-loading">
          Preparing exercises for these findings…
        </p>
      ) : null}

      {view.status === 'error' ? (
        <p className="text-xs leading-relaxed text-neutral-300" data-testid="mirror-overview-exercises-error">
          Exercise suggestions are not ready yet. You can try again further down.
        </p>
      ) : null}

      {view.status === 'ready' && view.exercises.length === 0 ? (
        <p className="text-xs leading-relaxed text-neutral-300">No exercises were suggested for this scan.</p>
      ) : null}

      {view.status === 'ready' && view.exercises.length > 0 ? (
        <ol className="flex flex-wrap gap-2">
          {view.exercises.map((exercise, index) => (
            <li key={exercise.id}>
              <button
                type="button"
                data-testid={`mirror-overview-exercise-${index}`}
                aria-label={`See how to do ${exercise.name}`}
                {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                className={cn(
                  mirrorGestureListItemClass,
                  'flex w-auto items-center gap-2 text-sm font-medium text-white',
                )}
                onClick={() => onSelect(index)}
              >
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border border-white/40 text-[10px]"
                >
                  {index + 1}
                </span>
                {exercise.name}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

interface SuggestedExerciseListProps {
  view: SuggestedExercisesView;
  onRetry: () => void;
  onStart: (exercises: Exercise[], index: number) => void;
  className?: string;
}

/** The AI exercise plan, each exercise explained, on the dark Smart Mirror results page. */
export const SuggestedExerciseList = forwardRef<HTMLElement, SuggestedExerciseListProps>(
  function SuggestedExerciseList({ view, onRetry, onStart, className }, ref) {
    if (view.status === 'idle') return null;

    return (
      <section
        ref={ref}
        aria-labelledby="mirror-suggested-exercises-title"
        data-testid="mirror-suggested-exercises"
        className={cn('flex flex-col gap-4', className)}
      >
        <header>
          <h2 id="mirror-suggested-exercises-title" className="text-lg font-semibold text-white">
            Suggested exercises
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-300">
            Picked by AI for the findings above. Check with your clinician before you start.
          </p>
        </header>

        {view.status === 'loading' ? (
          <div className="flex flex-col gap-3" role="status" data-testid="mirror-suggested-loading">
            <p className="text-sm text-neutral-300">
              Preparing exercises for your findings. This can take up to a minute.
            </p>
            {[0, 1].map((key) => (
              <div
                key={key}
                aria-hidden="true"
                className="h-36 rounded-xl border border-white/10 bg-white/5 animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : null}

        {view.status === 'error' ? (
          <div
            className="flex flex-col items-start gap-4 rounded-xl border border-white/20 px-4 py-4"
            data-testid="mirror-suggested-error"
          >
            <p className="text-sm leading-relaxed text-neutral-200">
              Exercise suggestions could not be prepared right now. Your analysis is saved, so you can try
              again.
            </p>
            <Button
              type="button"
              variant="outline"
              data-testid="mirror-suggested-retry"
              {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
              className={cn(mirrorGestureButtonClass)}
              onClick={onRetry}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {view.status === 'ready' ? (
          <ol className="flex flex-col gap-4">
            {view.exercises.map((exercise, index) => (
              <li
                key={exercise.id}
                data-testid={`mirror-suggested-exercise-${index}`}
                {...{ [SUGGESTED_EXERCISE_ATTR]: index }}
                tabIndex={-1}
                className="flex flex-col gap-3 rounded-xl border border-white/20 px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
              >
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/40 text-xs"
                    >
                      {index + 1}
                    </span>
                    {exercise.name}
                  </h3>
                  <p className="mt-1 text-xs text-neutral-300">{exerciseDoseLabel(exercise)}</p>
                </div>

                {exercise.description ? (
                  <p className="text-sm leading-relaxed text-neutral-200">{exercise.description}</p>
                ) : null}

                {exercise.targetBodyParts.length > 0 ? (
                  <p className="text-xs text-neutral-300">
                    <span className="font-medium text-neutral-100">Works on: </span>
                    {exercise.targetBodyParts.join(', ')}
                  </p>
                ) : null}

                {exercise.instructions.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-white">How to do it</h4>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-neutral-200">
                      {exercise.instructions.map((step, stepIndex) => (
                        <li key={stepIndex}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                {exercise.safetyNotes.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-amber-200">Take care</h4>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-neutral-300">
                      {exercise.safetyNotes.map((note, noteIndex) => (
                        <li key={noteIndex}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  data-testid={`mirror-suggested-start-${index}`}
                  aria-label={`Start ${exercise.name}`}
                  {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                  className={cn(mirrorGestureButtonClass, 'self-start')}
                  onClick={() => onStart(view.exercises, index)}
                >
                  Start exercise
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    );
  },
);
