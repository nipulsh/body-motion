import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { mirrorGestureMenuButtonClass, mirrorGestureNavClass } from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneClass } from '../smartMirror/mirrorTopZone';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

export function GamesPlaceholderScreen() {
  const { dispatch } = useWorkflow();

  // The rehab games (Fruit Catcher, Cross-Over Bubbles, March to the Beat) share
  // one home screen with its own game picker, so the menu needs one entry.
  const openRehab = () => dispatch({ type: 'SET_STAGE', stage: 'rehab_games' });

  return (
    <MirrorPortraitCard testId="mirror-games-card">
      <nav
        className={cn(mirrorGestureNavClass, mirrorTopZoneClass)}
        aria-label="Games"
      >
        <Button
          type="button"
          variant="outline"
          data-testid="play-balance-bird"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorGestureMenuButtonClass)}
          onClick={() => dispatch({ type: 'SET_STAGE', stage: 'balance_bird_game' })}
        >
          Balance birds
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="play-bowling"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorGestureMenuButtonClass)}
          onClick={() => dispatch({ type: 'SET_STAGE', stage: 'bowling_game' })}
        >
          Bowling
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="play-rehab-games"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorGestureMenuButtonClass)}
          onClick={openRehab}
        >
          Rehab games
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="games-back-home"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorGestureMenuButtonClass)}
          onClick={() => dispatch({ type: 'SET_STAGE', stage: 'mirror_home' })}
        >
          Back
        </Button>
      </nav>
    </MirrorPortraitCard>
  );
}
