import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { useWorkflow } from '../../workflow/WorkflowContext';
import {
  mirrorGestureButtonClass,
  mirrorGestureButtonGridClass,
  mirrorGestureMenuButtonClass,
} from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneClass } from '../smartMirror/mirrorTopZone';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

export function SmartMirrorExercisePlanScreen() {
  const { state, dispatch } = useWorkflow();
  const exercises = state.exercises ?? [];

  const startExercise = (index: number) => {
    dispatch({ type: 'SET_EXERCISE_INDEX', index });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_exercise_session' });
  };

  return (
    <MirrorPortraitCard testId="mirror-exercise-plan-card">
      <div className={cn('flex min-h-0 flex-col gap-6 p-6 sm:gap-8 sm:p-8', mirrorTopZoneClass)}>
        <div className="flex items-center justify-between gap-4">
          <p className="text-lg font-medium text-white">Exercise</p>
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-exercise-plan-back"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureButtonClass)}
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'mirror_home' })}
          >
            Back
          </Button>
        </div>

        {exercises.length === 0 ? (
          <p className="text-center text-sm text-neutral-300">No exercises available.</p>
        ) : (
          <ul className={cn(mirrorGestureButtonGridClass, 'min-h-0 flex-1 overflow-y-auto pr-1')}>
            {exercises.map((exercise, index) => (
              <li key={exercise.id}>
                <Button
                  type="button"
                  variant="outline"
                  data-testid={`mirror-exercise-pick-${index}`}
                  {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                  className={cn(mirrorGestureMenuButtonClass)}
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
