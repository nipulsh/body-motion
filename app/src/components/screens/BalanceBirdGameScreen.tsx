import { useState } from 'react';
import { useBalanceBirdGame } from '../../hooks/useBalanceBirdGame';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const mirrorControlButtonClass =
  'h-auto min-h-8 rounded-lg border border-black bg-white px-3 py-1 text-xs font-medium text-black shadow-none hover:bg-neutral-50';

const GAME_RULES = [
  'Birds fly across the play area while you stay visible to the camera.',
  'Lift one foot and hold a stable one-leg balance.',
  'You earn 1 point each time you achieve a stable balance (lower your foot to score again).',
  'When you are balanced as a bird passes nearby, the bird highlights — stay steady.',
];

export function BalanceBirdGameScreen() {
  const { dispatch } = useWorkflow();
  const { videoRef, canvasRef, stageRef, points, cameraError } = useBalanceBirdGame();
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <MirrorPortraitCard testId="mirror-game-card">
      <div className="relative flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div
          ref={stageRef}
          data-testid="mirror-game-stage"
          className="relative min-h-0 flex-1 overflow-hidden bg-black"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-contain opacity-35"
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

          <Button
            type="button"
            variant="outline"
            data-testid="mirror-game-rules-open"
            className={cn(
              mirrorControlButtonClass,
              'absolute right-3 top-3 z-20 h-auto min-h-8 border-white/50 bg-black/75 text-white hover:bg-black/90',
            )}
            onClick={() => setRulesOpen(true)}
          >
            Game Rules
          </Button>

          {rulesOpen ? (
            <div
              className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mirror-game-rules-title"
            >
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
                  data-testid="mirror-game-rules-close"
                  className="mt-4 w-full"
                  onClick={() => setRulesOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          ) : null}

          {cameraError ? (
            <p className="absolute bottom-3 left-3 right-3 z-20 text-center text-xs text-amber-200" role="alert">
              {cameraError}
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-game-exit"
            className={cn(mirrorControlButtonClass)}
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'mirror_home' })}
          >
            Exit
          </Button>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
