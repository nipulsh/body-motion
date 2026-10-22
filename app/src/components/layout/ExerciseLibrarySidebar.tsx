import { Dumbbell } from 'lucide-react';
import { EXERCISE_LIBRARY } from '../../exercise/library';
import { normalizeExercise } from '../../exercise/normalizeExercise';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';

interface ExerciseLibrarySidebarProps {
  collapsed: boolean;
}

export function ExerciseLibrarySidebar({ collapsed }: ExerciseLibrarySidebarProps) {
  const { dispatch, state } = useWorkflow();

  const startExercise = (index: number) => {
    const exercises = EXERCISE_LIBRARY.map(normalizeExercise);
    dispatch({ type: 'SET_EXERCISES', exercises });
    dispatch({ type: 'SET_EXERCISE_INDEX', index });
    dispatch({
      type: 'SET_EXERCISE_RETURN_STAGE',
      stage: state.stage === 'exercise_session' ? state.exerciseReturnStage : state.stage,
    });
    dispatch({ type: 'SET_STAGE', stage: 'exercise_session' });
  };

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mx-auto text-sidebar-foreground"
        title="Exercise library"
        onClick={() => startExercise(0)}
        aria-label="Start shoulder abduction from exercise library"
      >
        <Dumbbell className="size-4" />
      </Button>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Exercise library
      </p>
      <ScrollArea className="min-h-0 flex-1 -mx-1 px-1">
        <ul className="flex flex-col gap-1 pb-2">
          {EXERCISE_LIBRARY.map((exercise, index) => (
            <li key={exercise.id}>
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-2.5 py-2 text-left text-sidebar-foreground',
                  state.stage === 'exercise_session' &&
                    state.exercises?.[state.exerciseIndex]?.id === exercise.id &&
                    'bg-accent/60',
                )}
                onClick={() => startExercise(index)}
              >
                <span className="text-sm font-medium leading-snug">{exercise.name}</span>
                <span className="text-xs text-muted-foreground">
                  {exercise.recommendedReps} reps · wireframe tracking
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
