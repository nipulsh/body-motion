import { EXERCISE_LIBRARY } from '../../exercise/library';
import { normalizeExercise } from '../../exercise/normalizeExercise';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { mirrorGestureMenuButtonClass, mirrorGestureNavClass } from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneClass } from '../smartMirror/mirrorTopZone';
import { Button } from '../ui/button';
import { isMirrorAnalysisRunning, mirrorHomeReviewTarget } from './smartMirrorHomeAnalysis';
import { cn } from '@/lib/utils';

export function SmartMirrorHomeScreen() {
  const { state, dispatch } = useWorkflow();
  const { isOnline, offlineMessage } = useRequiresOnline();
  const analysisRunning = isMirrorAnalysisRunning(state);
  const reviewTarget = mirrorHomeReviewTarget(state);
  const analyseDisabled = !isOnline || analysisRunning;
  const analyseTitle = analysisRunning
    ? 'Analysis is still running'
    : !isOnline
      ? offlineMessage
      : undefined;

  const startAnalysis = () => {
    if (analyseDisabled) return;
    dispatch({ type: 'SET_SCAN_CAPTURE_MODE', mode: 'TIMED_BURST' });
    dispatch({ type: 'SET_JOB_COMPLETE_STAGE', stage: 'mirror_results' });
    dispatch({ type: 'RESET_CAPTURES' });
    dispatch({ type: 'SET_SCAN', scanId: null });
    dispatch({ type: 'CLEAR_JOB' });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_analysis' });
  };

  const openReview = () => {
    if (reviewTarget === 'progress') {
      dispatch({ type: 'SET_STAGE', stage: 'mirror_processing' });
      return;
    }
    if (reviewTarget === 'results') {
      dispatch({ type: 'SET_STAGE', stage: 'mirror_results' });
    }
  };

  const startExercise = () => {
    const exercises = EXERCISE_LIBRARY.map(normalizeExercise);
    dispatch({ type: 'SET_EXERCISES', exercises });
    dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: 'mirror_home' });
    dispatch({ type: 'SET_EXERCISE_INDEX', index: 0 });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_exercise_plan' });
  };

  const startGame = () => {
    dispatch({ type: 'SET_STAGE', stage: 'games_placeholder' });
  };

  return (
    <MirrorPortraitCard testId="mirror-home-card">
      <nav
        className={cn(mirrorGestureNavClass, mirrorTopZoneClass)}
        aria-label="Smart mirror home"
      >
        <Button
          type="button"
          variant="outline"
          disabled={analyseDisabled}
          title={analyseTitle}
          data-testid="mirror-home-analyse"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorGestureMenuButtonClass)}
          onClick={startAnalysis}
        >
          Analyse
        </Button>

        {reviewTarget ? (
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-home-review"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureMenuButtonClass)}
            onClick={openReview}
          >
            Review analysis
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          data-testid="mirror-home-exercise"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorGestureMenuButtonClass)}
          onClick={startExercise}
        >
          Exercise
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="mirror-home-game"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorGestureMenuButtonClass)}
          onClick={startGame}
        >
          Game
        </Button>
      </nav>
    </MirrorPortraitCard>
  );
}
