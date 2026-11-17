/**
 * Shape of the picture a game works on (after the camera turn, see `usePosePreviewCamera`).
 * `unknown` means no frame has been seen yet.
 */
export type GameVideoOrientation = 'vertical' | 'horizontal' | 'unknown';

/**
 * Height greater than width is a vertical image. A square or wider frame is horizontal.
 * A missing or empty size stays unknown so the stage does not flip before the camera reports.
 */
export function orientationFromFrame(width: number, height: number): GameVideoOrientation {
  if (!(width > 0) || !(height > 0)) return 'unknown';
  return height > width ? 'vertical' : 'horizontal';
}

/**
 * Every page, games included, sits on the portrait stage (see `KioskScreenRotate`), and
 * the games turn the camera pose upright before using it. Game pose and layout math
 * waits for the first camera frame and for that portrait stage to be on screen, so the
 * stage is measured at its portrait size.
 */
export function gameCalculationsReady(
  orientation: GameVideoOrientation,
  rotationApplied: boolean | null,
): boolean {
  return orientation !== 'unknown' && rotationApplied === true;
}

let kioskRotationApplied: boolean | null = null;
let orientation: GameVideoOrientation = 'unknown';
const rotationListeners = new Set<() => void>();

/** Called after the shell commits the rotation, so game math can follow it. */
export function setKioskRotationApplied(rotated: boolean): void {
  if (rotated === kioskRotationApplied) return;
  kioskRotationApplied = rotated;
  for (const listener of rotationListeners) listener();
}

export function subscribeKioskRotation(listener: () => void): () => void {
  rotationListeners.add(listener);
  return () => {
    rotationListeners.delete(listener);
  };
}

export function gameCalculationsReadyNow(): boolean {
  return gameCalculationsReady(orientation, kioskRotationApplied);
}

const listeners = new Set<() => void>();

export function getGameVideoOrientation(): GameVideoOrientation {
  return orientation;
}

export function setGameVideoOrientation(next: GameVideoOrientation): void {
  if (next === orientation) return;
  orientation = next;
  for (const listener of listeners) listener();
}

export function subscribeGameVideoOrientation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
