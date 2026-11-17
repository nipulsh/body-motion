import type { PoseLandmark, PoseResult } from '../types';
import type { FrameSize } from './mirrorReflection';
import { bodyUpOnScreen } from './wireframeTracking';

/**
 * Clockwise turn, in degrees, that stands the camera picture upright.
 *
 * On the kiosk the camera is turned on its side together with the TV, so the raw
 * picture shows the patient lying sideways. Games run on a portrait stage and want
 * the patient upright, as a camera standing on its end would see them.
 */
export type CameraTurn = 0 | 90 | 180 | 270;

/** A first reading must hold this long before it replaces the starting turn. */
export const CAMERA_TURN_FIRST_LOCK_MS = 300;
/** Once locked, a different reading must hold this long: a lean or a bad frame never flips the game. */
export const CAMERA_TURN_SWITCH_MS = 1500;

function isQuarterTurn(turn: CameraTurn): boolean {
  return turn === 90 || turn === 270;
}

/** Normalized image point after turning the picture clockwise by `turn`. */
function turnPoint(x: number, y: number, turn: CameraTurn): { x: number; y: number } {
  switch (turn) {
    case 90:
      return { x: 1 - y, y: x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: y, y: 1 - x };
    default:
      return { x, y };
  }
}

/** A 3D direction (x right, y down, z depth) after the same picture turn; depth is unchanged. */
function turnVector(x: number, y: number, turn: CameraTurn): { x: number; y: number } {
  switch (turn) {
    case 90:
      return { x: -y, y: x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: y, y: -x };
    default:
      return { x, y };
  }
}

/**
 * The pose as the turned (upright) picture shows it. Landmark names keep their meaning
 * and the view stays the camera's own (not mirrored). The outline and spine are dropped
 * on a turn because they are still in the raw picture's pixels.
 */
export function turnPose(pose: PoseResult, turn: CameraTurn): PoseResult {
  if (turn === 0) return pose;
  const landmarks: PoseLandmark[] = pose.landmarks.map((l) => ({ ...l, ...turnPoint(l.x, l.y, turn) }));
  const worldLandmarks = pose.worldLandmarks?.map((l) => ({ ...l, ...turnVector(l.x, l.y, turn) }));
  const frameAspect =
    pose.frameAspect && pose.frameAspect > 0 && isQuarterTurn(turn) ? 1 / pose.frameAspect : pose.frameAspect;
  const turned: PoseResult = {
    landmarks,
    confidence: pose.confidence,
    timestamp: pose.timestamp,
  };
  if (worldLandmarks) turned.worldLandmarks = worldLandmarks;
  if (frameAspect !== undefined) turned.frameAspect = frameAspect;
  return turned;
}

/** Picture size after the turn: a quarter turn swaps width and height. */
export function turnFrameSize<T extends FrameSize>(size: T, turn: CameraTurn): T {
  if (!isQuarterTurn(turn)) return size;
  return { ...size, width: size.height, height: size.width };
}

/**
 * The turn that stands this body up, read from where its shoulders sit relative to its
 * ankles (or knees, or hips) in the raw, unmirrored picture. Null without a body.
 */
export function detectCameraTurn(
  landmarks: readonly PoseLandmark[] | null | undefined,
  frame: FrameSize | null | undefined,
): CameraTurn | null {
  const up = bodyUpOnScreen(landmarks, frame, false);
  if (!up) return null;
  if (up.y < 0) return 0;
  if (up.y > 0) return 180;
  return up.x > 0 ? 270 : 90;
}

/**
 * Keeps one camera turn for a play session. It starts from a known turn (the kiosk's last),
 * takes the first steady reading of a body, and after that only changes when a different
 * reading holds for `CAMERA_TURN_SWITCH_MS`.
 */
export class CameraTurnTracker {
  private current: CameraTurn;
  private isLocked = false;
  private candidate: { turn: CameraTurn; since: number } | null = null;

  constructor(
    initial: CameraTurn,
    private readonly firstLockMs: number = CAMERA_TURN_FIRST_LOCK_MS,
    private readonly switchMs: number = CAMERA_TURN_SWITCH_MS,
  ) {
    this.current = initial;
  }

  get turn(): CameraTurn {
    return this.current;
  }

  /** True once a body has confirmed the turn. */
  get locked(): boolean {
    return this.isLocked;
  }

  update(
    landmarks: readonly PoseLandmark[] | null | undefined,
    frame: FrameSize | null | undefined,
    tMs: number,
  ): CameraTurn {
    const reading = detectCameraTurn(landmarks, frame);
    if (reading === null) {
      this.candidate = null;
      return this.current;
    }
    if (this.isLocked && reading === this.current) {
      this.candidate = null;
      return this.current;
    }
    if (!this.candidate || this.candidate.turn !== reading || tMs < this.candidate.since) {
      this.candidate = { turn: reading, since: tMs };
    }
    const hold = this.isLocked ? this.switchMs : this.firstLockMs;
    if (tMs - this.candidate.since >= hold) {
      this.current = reading;
      this.isLocked = true;
      this.candidate = null;
    }
    return this.current;
  }
}
