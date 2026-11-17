export const MIRROR_SCAN_INSTRUCTION =
  'Stand straight facing the camera so your full body is visible. Keep your feet on the floor and stay still. After three, two, one, we take ten pictures. Then we will ask you to turn right, and then to turn your back to the mirror, for ten more each.';

/** What the user is told, on screen and aloud, at each step of the guided capture. */
export const MIRROR_SCAN_STEP_COPY = {
  front: { capture: 'Stand straight and stay still', turn: '' },
  right: { capture: 'Hold still', turn: 'Turn to your right' },
  back: { capture: 'Hold still', turn: 'Turn right again so your back faces the mirror' },
} as const;

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
