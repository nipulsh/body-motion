import { HandDetector } from './HandDetector';

let detector: HandDetector | null = null;
let retainCount = 0;
let processor: symbol | null = null;

/**
 * One HandLandmarker for navigation and the skeleton overlay.
 * Callers retain the instance and only the current processor runs detection.
 */
export function retainSharedHandDetector(): HandDetector {
  retainCount += 1;
  if (!detector) detector = new HandDetector();
  return detector;
}

export function releaseSharedHandDetector(): void {
  retainCount = Math.max(0, retainCount - 1);
  if (retainCount > 0) return;
  detector?.dispose();
  detector = null;
  processor = null;
}

/** Returns a token when this caller may run detectForVideo. Null if another caller already does. */
export function claimHandProcessor(): symbol | null {
  if (processor) return null;
  processor = Symbol('hand-processor');
  return processor;
}

export function holdsHandProcessor(token: symbol | null): boolean {
  return token !== null && processor === token;
}

/**
 * Exercise tracking takes detectForVideo even when menu navigation claimed it,
 * so landmarks come from the exercise camera. The previous token stops owning detection.
 */
export function preemptHandProcessor(): symbol {
  const token = Symbol('hand-processor');
  processor = token;
  return token;
}

export function releaseHandProcessor(token: symbol): void {
  if (processor === token) processor = null;
}
