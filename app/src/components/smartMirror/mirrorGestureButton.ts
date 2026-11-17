/**
 * Text-only controls for the hand-gesture mirror kiosk.
 * Large tap targets (~80–96px tall) for fist selection.
 *
 * Hand hover uses `data-mirror-hand-hover` (see syncMirrorGestureHover) because the
 * on-screen pointer is not the OS cursor, so CSS `:hover` does not run for gestures.
 */

const mirrorGestureHandHoverLight =
  'data-[mirror-hand-hover=true]:-translate-y-0.5 data-[mirror-hand-hover=true]:border-cyan-400 data-[mirror-hand-hover=true]:bg-cyan-50 data-[mirror-hand-hover=true]:text-black data-[mirror-hand-hover=true]:shadow-[0_8px_28px_rgba(34,211,238,0.35)] data-[mirror-hand-hover=true]:ring-2 data-[mirror-hand-hover=true]:ring-cyan-300/70';

const mirrorGestureButtonBase = [
  'h-auto rounded-2xl border-2 border-black bg-white font-semibold leading-snug text-black shadow-none',
  'transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none',
  'hover:-translate-y-0.5 hover:border-cyan-500/80 hover:bg-cyan-50 hover:shadow-[0_8px_24px_rgba(34,211,238,0.28)]',
  mirrorGestureHandHoverLight,
].join(' ');

/** Single actions (Exit, Back in a header row). */
export const mirrorGestureButtonClass = `${mirrorGestureButtonBase} min-h-20 w-auto max-w-[22rem] px-9 py-5 text-xl sm:max-w-[24rem] sm:min-h-24 sm:px-10 sm:py-6 sm:text-2xl`;

/** Stacked menu rows (home, exercise list): full width of the nav column. */
export const mirrorGestureMenuButtonClass = `${mirrorGestureButtonBase} min-h-20 w-full px-9 py-5 text-xl sm:min-h-24 sm:px-10 sm:py-6 sm:text-2xl`;

/** Vertical stack of gesture menu buttons with roomy spacing. */
export const mirrorGestureButtonStackClass =
  'mx-auto flex w-full max-w-[min(100%,26rem)] flex-col items-stretch gap-7 sm:max-w-[min(100%,28rem)] sm:gap-8';

/** Two columns of gesture menu buttons, so longer lists fit the top 40% of the screen (`mirrorTopZone`). */
export const mirrorGestureButtonGridClass =
  'mx-auto grid w-full max-w-[min(100%,52rem)] grid-cols-2 gap-5 sm:gap-6 [&_button]:whitespace-normal';

/** Top-of-screen mirror menus (home, games). */
export const mirrorGestureNavClass = `${mirrorGestureButtonStackClass} shrink-0 px-8 pt-8 pb-6 sm:px-10 sm:pt-10 sm:pb-8`;

const mirrorGestureHandHoverDark =
  'data-[mirror-hand-hover=true]:border-cyan-300/90 data-[mirror-hand-hover=true]:bg-cyan-400/15 data-[mirror-hand-hover=true]:text-white data-[mirror-hand-hover=true]:shadow-[0_0_24px_rgba(34,211,238,0.4)] data-[mirror-hand-hover=true]:ring-2 data-[mirror-hand-hover=true]:ring-cyan-300/50';

/** Legible on dark overlays (game rules dialog, etc.). */
export const mirrorGestureButtonOnDarkClass = [
  'border-white/50 bg-black/75 text-white',
  'hover:border-cyan-300/70 hover:bg-cyan-400/10 hover:shadow-[0_0_20px_rgba(34,211,238,0.25)]',
  mirrorGestureHandHoverDark,
].join(' ');

/** Compact list rows on dark mirror screens (e.g. muscle picker). */
export const mirrorGestureListItemClass = [
  'w-full rounded-xl border border-white/20 bg-black px-3 py-2.5 text-left',
  'transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none',
  'hover:border-white/45 hover:bg-white/5',
  'data-[mirror-hand-hover=true]:border-cyan-300/80 data-[mirror-hand-hover=true]:bg-cyan-400/10 data-[mirror-hand-hover=true]:shadow-[0_0_20px_rgba(34,211,238,0.28)] data-[mirror-hand-hover=true]:-translate-y-px',
].join(' ');

export const mirrorGestureListItemSelectedClass =
  'border-emerald-300 bg-emerald-400/15 data-[mirror-hand-hover=true]:border-emerald-200 data-[mirror-hand-hover=true]:bg-emerald-400/20 data-[mirror-hand-hover=true]:shadow-[0_0_22px_rgba(52,211,153,0.35)]';
