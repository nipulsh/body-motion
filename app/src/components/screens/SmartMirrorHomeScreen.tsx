import { EXERCISE_LIBRARY } from '../../exercise/library';
import { normalizeExercise } from '../../exercise/normalizeExercise';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const mirrorMenuButtonClass =
  'flex min-h-[4.75rem] flex-1 w-full rounded-xl border border-black bg-white text-xl font-medium text-black shadow-none hover:bg-neutral-50 sm:text-2xl';

export function SmartMirrorHomeScreen() {
  const { dispatch } = useWorkflow();
  const { isOnline, offlineMessage } = useRequiresOnline();

  const startAnalysis = () => {
    if (!isOnline) return;
    dispatch({ type: 'SET_SCAN_CAPTURE_MODE', mode: 'TIMED_BURST' });
    dispatch({ type: 'SET_JOB_COMPLETE_STAGE', stage: 'mirror_results' });
    dispatch({ type: 'RESET_CAPTURES' });
    dispatch({ type: 'SET_SCAN', scanId: null });
    dispatch({ type: 'CLEAR_JOB' });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_analysis' });
  };

  const startExercise = () => {
    const exercises = EXERCISE_LIBRARY.map(normalizeExercise);
    dispatch({ type: 'SET_EXERCISES', exercises });
    dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: 'mirror_home' });
    dispatch({ type: 'SET_EXERCISE_INDEX', index: 0 });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_exercise_plan' });
  };

  const startGame = () => {
    dispatch({ type: 'SET_STAGE', stage: 'balance_bird_game' });
  };

  return (
    <MirrorPortraitCard testId="mirror-home-card">
      <nav
        className="flex min-h-0 flex-1 flex-col gap-4 p-6 pb-20 sm:gap-6 sm:p-8 sm:pb-24"
        aria-label="Smart mirror home"
      >
        <Button
          type="button"
          variant="outline"
          disabled={!isOnline}
          title={!isOnline ? offlineMessage : undefined}
          data-testid="mirror-home-analyse"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorMenuButtonClass)}
          onClick={startAnalysis}
        >
          Analyse
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="mirror-home-exercise"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorMenuButtonClass)}
          onClick={startExercise}
        >
          Exercise
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="mirror-home-game"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorMenuButtonClass)}
          onClick={startGame}
        >
          Game
        </Button>
      </nav>
    </MirrorPortraitCard>
  );
}
