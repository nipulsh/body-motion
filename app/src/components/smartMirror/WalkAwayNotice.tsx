/** Countdown shown when the player has stepped out of the mirror during a game. Under the top-corner buttons, in the top 40% of the screen. */
export function WalkAwayNotice({ secondsLeft }: { secondsLeft?: number | null }) {
  if (secondsLeft == null) return null;
  return (
    <div
      data-testid="mirror-game-walkaway"
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-32 z-40 flex justify-center px-4 sm:top-36"
    >
      <div className="max-w-[22rem] rounded-lg bg-black/80 px-4 py-3 text-center">
        <p className="text-base font-semibold tabular-nums text-amber-300">Closing the game in {secondsLeft}</p>
        <p className="mt-1 text-sm text-white/80">Step back in front of the mirror to keep playing.</p>
      </div>
    </div>
  );
}
