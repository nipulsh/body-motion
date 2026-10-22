import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const mirrorMenuButtonClass =
  'h-auto min-h-[3.5rem] w-full rounded-xl border border-black bg-white text-base font-medium text-black shadow-none hover:bg-neutral-50';

export function SmartMirrorExercisePlanScreen() {
  const { state, dispatch } = useWorkflow();
  const exercises = state.exercises ?? [];

  const startExercise = (index: number) => {
    dispatch({ type: 'SET_EXERCISE_INDEX', index });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_exercise_session' });
  };

  return (
    <MirrorPortraitCard testId="mirror-exercise-plan-card">
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-2">
          <p className="text-lg font-medium text-white">Exercise</p>
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-exercise-plan-back"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className="h-auto min-h-8 rounded-lg border border-black bg-white px-3 py-1 text-xs font-medium text-black shadow-none hover:bg-neutral-50"
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'mirror_home' })}
          >
            Back
          </Button>
        </div>

        {exercises.length === 0 ? (
          <p className="text-center text-sm text-neutral-300">No exercises available.</p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {exercises.map((exercise, index) => (
              <li key={exercise.id}>
                <Button
                  type="button"
                  variant="outline"
                  data-testid={`mirror-exercise-pick-${index}`}
                  {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                  className={cn(mirrorMenuButtonClass)}
                  onClick={() => startExercise(index)}
                >
                  {exercise.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MirrorPortraitCard>
  );
}
