import type { CameraTurn } from '@vision/pose/uprightPose';

export const KIOSK_CAMERA_TURN_STORAGE_KEY = 'bpsy.kiosk.cameraTurn';

/**
 * The kiosk rig: camera turned on its side with the TV, the patient's head toward the
 * raw picture's right edge (the exercise session's mirrored video shows them upright),
 * so the picture turns a quarter turn left (270° clockwise) to stand them up.
 */
export const DEFAULT_KIOSK_CAMERA_TURN: CameraTurn = 270;

const TURNS: readonly CameraTurn[] = [0, 90, 180, 270];

/** The turn a body last confirmed on this kiosk, so the next game starts the right way up. */
export function loadKioskCameraTurn(): CameraTurn {
  try {
    const stored = globalThis.localStorage?.getItem(KIOSK_CAMERA_TURN_STORAGE_KEY);
    return TURNS.find((turn) => String(turn) === stored) ?? DEFAULT_KIOSK_CAMERA_TURN;
  } catch {
    return DEFAULT_KIOSK_CAMERA_TURN;
  }
}

export function saveKioskCameraTurn(turn: CameraTurn): void {
  try {
    globalThis.localStorage?.setItem(KIOSK_CAMERA_TURN_STORAGE_KEY, String(turn));
  } catch {
    // Storage blocked: the next game reads the turn from the body again.
  }
}
