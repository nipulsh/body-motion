import type { ScanState } from '../types';

const IDLE_SCAN_STATES: ReadonlySet<ScanState> = new Set([
  'idle',
  'completed',
  'cancelled',
  'error',
]);

/** A second pose loop would share one MediaPipe timestamp clock with scan or exercise. */
export function canStartPosePreviewLoop(exerciseActive: boolean, scanState: ScanState): boolean {
  return !exerciseActive && IDLE_SCAN_STATES.has(scanState);
}
