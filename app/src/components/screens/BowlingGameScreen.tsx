import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { frameMarks, type BowlingGameScore } from '@vision/games/bowling/bowlingScoring';
import { useBowlingGame } from '../../hooks/useBowlingGame';
import { useWorkflow } from '../../workflow/WorkflowContext';
import {
  mirrorGestureButtonClass,
  mirrorGestureButtonOnDarkClass,
} from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneOverlayClass } from '../smartMirror/mirrorTopZone';
import { WalkAwayNotice } from '../smartMirror/WalkAwayNotice';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

function ScoreSheet({ score }: { score: BowlingGameScore }) {
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Score by frame">
      {score.frames.map((frame, i) => {
        const marks = frameMarks(frame, i);
        return (
          <li
            key={i}
            className="rounded-md border border-white/25 px-1 py-1.5 text-center"
            data-testid={`bowling-frame-${i + 1}`}
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/55">{i + 1}</p>
            <p className="mt-0.5 font-mono text-sm tabular-nums text-white">{marks.join(' ')}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">{frame.cumulative ?? ''}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function BowlingGameScreen() {
  const { dispatch } = useWorkflow();
  const exit = () => dispatch({ type: 'SET_STAGE', stage: 'games_placeholder' });
  // There is no hand pointer in the games: nobody in front of the mirror sends the player back to the games page.
  const {
    videoRef,
    canvasRef,
    stageRef,
    phase,
    cue,
    finalScore,
    cameraError,
    sceneError,
    playAgain,
    leavingInSeconds,
  } = useBowlingGame({ onPlayerLeft: exit });

  return (
    <MirrorPortraitCard testId="mirror-bowling-card">
      <div className="relative flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div
          ref={stageRef}
          data-testid="bowling-stage"
          className="relative min-h-0 flex-1 overflow-hidden bg-black"
        >
          {/* Feeds pose tracking only. The screen shows just the lane, pins and ball. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            aria-hidden
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 block h-full w-full"
            aria-label="Bowling lane"
            role="img"
            data-testid="bowling-canvas"
          />

          {cue && phase === 'aiming' ? (
            <div
              data-testid="bowling-cue"
              data-tone={cue.tone}
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4"
            >
              <div className="max-w-[22rem] rounded-lg bg-black/70 px-3 py-2 text-center">
                <p
                  className={cn(
                    'text-sm font-medium leading-snug',
                    cue.tone === 'ready' && 'text-emerald-300',
                    cue.tone === 'warn' && 'text-amber-300',
                    cue.tone === 'info' && 'text-white/85',
                  )}
                >
                  {cue.text}
                </p>
                {cue.progress !== null ? (
                  <div className="mx-auto mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/15" aria-hidden>
                    <div
                      className="h-full rounded-full bg-emerald-300 transition-[width] duration-100"
                      style={{ width: `${Math.round(cue.progress * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase === 'loading' && !sceneError ? (
            <p className="absolute inset-x-0 top-[20%] z-20 text-center text-sm text-white/60" role="status">
              Setting up the lane…
            </p>
          ) : null}

          {finalScore ? (
            <div
              className="absolute inset-0 z-30 bg-black/80"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bowling-final-title"
              data-testid="bowling-game-over"
            >
              <div className={cn(mirrorTopZoneOverlayClass, 'p-4')}>
                <div className="max-h-full w-full max-w-[26rem] overflow-y-auto rounded-xl border border-white/25 bg-black p-4 text-white">
                  <h2 id="bowling-final-title" className="text-base font-semibold">
                    Game complete
                  </h2>
                  <p className="mt-1 text-4xl font-semibold tabular-nums" data-testid="bowling-final-total">
                    {finalScore.total}
                  </p>
                  <div className="mt-4">
                    <ScoreSheet score={finalScore} />
                  </div>
                  <div className="mt-5 flex flex-col gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="bowling-play-again"
                      {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
                      className={cn(mirrorGestureButtonClass, mirrorGestureButtonOnDarkClass, 'w-full')}
                      onClick={playAgain}
                    >
                      Play again
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <WalkAwayNotice secondsLeft={leavingInSeconds} />

          {sceneError || cameraError ? (
            <p className="absolute left-3 right-3 top-[34%] z-20 text-center text-xs text-amber-200" role="alert">
              {sceneError ?? cameraError}
            </p>
          ) : null}

          {/* Its own top corner, absolute: no row under the lane, and in the top 40% of the screen. */}
          <Button
            type="button"
            variant="outline"
            data-testid="bowling-exit"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureButtonClass, 'absolute right-3 top-3 z-40')}
            onClick={exit}
          >
            Exit
          </Button>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
