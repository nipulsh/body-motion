import { ArrowLeft, Bird } from 'lucide-react';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { Button } from '../ui/button';

export function GamesPlaceholderScreen() {
  const { dispatch } = useWorkflow();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-black px-8 py-12 text-center text-white">
      <p className="text-sm font-medium uppercase tracking-[0.35em] text-white/60">Games</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Smart Mirror</h1>
      <p className="mt-6 max-w-md text-lg text-white/75">Pick a lightweight game. More coming later.</p>

      <Button
        type="button"
        variant="secondary"
        data-testid="play-balance-bird"
        className="mt-10 flex h-auto min-h-[5.5rem] w-full max-w-md flex-col gap-2 rounded-2xl border border-white/15 bg-white/10 px-8 py-6 text-lg font-semibold text-white hover:bg-white/15"
        onClick={() => dispatch({ type: 'SET_STAGE', stage: 'balance_bird_game' })}
      >
        <Bird className="size-8" aria-hidden />
        Balance birds
        <span className="text-sm font-normal text-white/70">Stand on one leg while birds fly by</span>
      </Button>

      <Button
        type="button"
        variant="secondary"
        data-testid="games-back-home"
        className="mt-6 min-h-14 gap-2 rounded-2xl border border-white/15 bg-white/10 px-8 text-lg text-white hover:bg-white/15"
        onClick={() => dispatch({ type: 'SET_STAGE', stage: 'mirror_home' })}
      >
        <ArrowLeft className="size-5" aria-hidden />
        Back to home
      </Button>
    </div>
  );
}
