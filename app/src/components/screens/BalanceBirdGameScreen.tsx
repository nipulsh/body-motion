import { useState } from 'react';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { uprightVideoStyle } from '../../games/uprightVideo';
import { useBalanceBirdGame } from '../../hooks/useBalanceBirdGame';
import { useWorkflow } from '../../workflow/WorkflowContext';
import {
  mirrorGestureButtonClass,
  mirrorGestureButtonOnDarkClass,
  mirrorGestureMenuButtonClass,
} from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneOverlayClass } from '../smartMirror/mirrorTopZone';
import { WalkAwayNotice } from '../smartMirror/WalkAwayNotice';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const GAME_RULES = [
  'Birds fly across the play area while you stay visible to the camera.',
  'Lift one foot and hold a stable one-leg balance.',
  'You earn 1 point each time you achieve a stable balance (lower your foot to score again).',
  'When you are balanced as a bird passes nearby, the bird highlights — stay steady.',
];

export function BalanceBirdGameScreen() {
  const { dispatch } = useWorkflow();
  // There is no hand pointer in the games: stepping out of the mirror closes the game.
  const { videoRef, canvasRef, stageRef, points, cameraError, leavingInSeconds, cameraTurn, pictureAspect } =
    useBalanceBirdGame({
      onPlayerLeft: () => dispatch({ type: 'SET_STAGE', stage: 'games_placeholder' }),
    });
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <MirrorPortraitCard testId="mirror-game-card">
      <div className="relative flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div
          ref={stageRef}
          data-testid="mirror-game-stage"
          className="relative min-h-0 flex-1 overflow-hidden bg-black [container-type:size]"
        >
          {/* Turned and mirrored like the pose the game uses, so the player marker sits on the body. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="pointer-events-none opacity-35"
            style={uprightVideoStyle(cameraTurn, pictureAspect, true)}
            data-camera-turn={cameraTurn}
            aria-hidden
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
            data-testid="balance-bird-canvas"
          />

          <div
            data-testid="mirror-game-points"
            className="absolute left-3 top-3 z-20 min-w-[4.5rem] rounded-lg border border-white/50 bg-black/75 px-2.5 py-1.5 text-center"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/70">Points</p>
            <p className="text-lg font-semibold tabular-nums text-white">{points}</p>
          </div>

          {/* Top corner, so the buttons stay in the top 40% and the field below is all game. */}
          <div className="absolute right-3 top-3 z-20 flex items-start gap-3">
            <Button
              type="button"
              variant="outline"
              data-testid="mirror-game-rules-open"
              {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
              className={cn(mirrorGestureButtonClass, mirrorGestureButtonOnDarkClass)}
              onClick={() => setRulesOpen(true)}
            >
              Game Rules
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="mirror-game-exit"
              {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
              className={cn(mirrorGestureButtonClass)}
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'mirror_home' })}
            >
              Exit
            </Button>
          </div>

          {rulesOpen ? (
            <div
              className="absolute inset-0 z-30 bg-black/70"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mirror-game-rules-title"
            >
              <div className={cn(mirrorTopZoneOverlayClass, 'p-4')}>
                <div className="max-h-full w-full overflow-y-auto rounded-xl border border-white/30 bg-black p-4 text-left text-white shadow-lg">
                  <h2 id="mirror-game-rules-title" className="text-base font-semibold">
                    Game Rules
                  </h2>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                    {GAME_RULES.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="mirror-game-rules-close"
                    {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                    className={cn(mirrorGestureMenuButtonClass, mirrorGestureButtonOnDarkClass, 'mt-4')}
                    onClick={() => setRulesOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <WalkAwayNotice secondsLeft={leavingInSeconds} />

          {cameraError ? (
            <p className="absolute left-3 right-3 top-[34%] z-20 text-center text-xs text-amber-200" role="alert">
              {cameraError}
            </p>
          ) : null}
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
