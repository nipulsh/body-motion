export const MIRROR_SCAN_INSTRUCTION =
  'Stand facing the camera so your full body is visible. Keep your feet on the floor and stay still. When you hear three, two, one, we will capture your movement for eight seconds.';

/** Spoken briefing length before the numeric countdown (ms). */
export const MIRROR_SCAN_INSTRUCTION_HOLD_MS = 7000;

export type MirrorScanCountdownStep = 3 | 2 | 1;

export const MIRROR_SCAN_COUNTDOWN_SEQUENCE: MirrorScanCountdownStep[] = [3, 2, 1];

export const MIRROR_SCAN_COUNTDOWN_MS = 1000;

export function nextMirrorScanCountdownStep(
  step: MirrorScanCountdownStep,
): MirrorScanCountdownStep | null {
  const index = MIRROR_SCAN_COUNTDOWN_SEQUENCE.indexOf(step);
  if (index < 0 || index >= MIRROR_SCAN_COUNTDOWN_SEQUENCE.length - 1) return null;
  return MIRROR_SCAN_COUNTDOWN_SEQUENCE[index + 1]!;
}
