import { palmCenter } from './handPointer';

export interface HandLandmark2D {
  x: number;
  y: number;
}

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

/**
 * A finger counts as curled when the tip has come back to its knuckle.
 * 1 is the knuckle-to-middle-joint length. A closed fist sits near 1 or below.
 * A partial bend still leaves the tip well beyond the middle joint.
 */
const FINGER_CURL_RATIO = 1.3;

/** Thumb tip must sit near a finger knuckle, within this multiple of palm size. */
const THUMB_TUCK_RATIO = 0.95;

/** Hands farther apart than this are not the same pointer hand. */
const PRIMARY_MATCH_DISTANCE = 0.4;

/** Keep the pointer hand this many missed frames before following a different one. */
const PRIMARY_LOST_FRAMES = 5;

const FINGERS: readonly { tip: number; pip: number; mcp: number }[] = [
  { tip: INDEX_TIP, pip: INDEX_PIP, mcp: INDEX_MCP },
  { tip: MIDDLE_TIP, pip: MIDDLE_PIP, mcp: MIDDLE_MCP },
  { tip: RING_TIP, pip: RING_PIP, mcp: RING_MCP },
  { tip: PINKY_TIP, pip: PINKY_PIP, mcp: PINKY_MCP },
];

function dist(a: HandLandmark2D, b: HandLandmark2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function fingerCurled(
  landmarks: readonly HandLandmark2D[],
  tip: number,
  pip: number,
  mcp: number,
): boolean {
  const segment = dist(landmarks[mcp]!, landmarks[pip]!);
  if (segment < 1e-4) return false;
  return dist(landmarks[tip]!, landmarks[mcp]!) <= segment * FINGER_CURL_RATIO;
}

function thumbTucked(landmarks: readonly HandLandmark2D[], scale: number): boolean {
  const tip = landmarks[THUMB_TIP]!;
  const reach = Math.min(dist(tip, landmarks[INDEX_MCP]!), dist(tip, landmarks[MIDDLE_MCP]!));
  return reach <= scale * THUMB_TUCK_RATIO;
}

/**
 * True when the four fingers are curled into the palm and the thumb is tucked.
 * Compares each fingertip to its own knuckle. A global wrist cutoff misses a
 * normal fist whose tips rest on the knuckles, which is the usual closed hand.
 */
export function isFistGesture(landmarks: readonly HandLandmark2D[]): boolean {
  if (landmarks.length < 21) return false;

  const scale = dist(landmarks[WRIST]!, landmarks[MIDDLE_MCP]!);
  if (scale < 0.02) return false;

  const fingersFolded = FINGERS.every((finger) =>
    fingerCurled(landmarks, finger.tip, finger.pip, finger.mcp),
  );
  return fingersFolded && thumbTucked(landmarks, scale);
}

export interface ClickHand {
  landmarks: readonly HandLandmark2D[];
}

/**
 * Follows one hand across a two-hand result.
 * MediaPipe lists hands by score, so the fist often stops being index 0 while
 * it is closing. The pointer hand stays the one nearest the previous palm.
 */
export class PrimaryHandTracker {
  private palm: HandLandmark2D | null = null;
  private lostFrames = 0;

  reset(): void {
    this.palm = null;
    this.lostFrames = 0;
  }

  select(hands: readonly ClickHand[]): readonly HandLandmark2D[] | null {
    let bestLandmarks: readonly HandLandmark2D[] | null = null;
    let bestPalm: HandLandmark2D | null = null;
    let bestDist = Infinity;

    for (const hand of hands) {
      if (hand.landmarks.length < 21) continue;
      const palm = palmCenter(hand.landmarks);
      if (!palm) continue;
      const distance = this.palm ? dist(palm, this.palm) : 0;
      if (distance < bestDist) {
        bestDist = distance;
        bestPalm = palm;
        bestLandmarks = hand.landmarks;
      }
    }

    if (!bestLandmarks || !bestPalm) {
      this.lostFrames += 1;
      if (this.lostFrames > PRIMARY_LOST_FRAMES) this.palm = null;
      return null;
    }

    const pointerHandMissing = this.palm !== null && bestDist > PRIMARY_MATCH_DISTANCE;
    if (pointerHandMissing) {
      this.lostFrames += 1;
      if (this.lostFrames <= PRIMARY_LOST_FRAMES) return null;
    } else {
      this.lostFrames = 0;
    }

    this.palm = bestPalm;
    return bestLandmarks;
  }
}

export interface FistClickGateConfig {
  /** Frames fist must be held before arming a click. */
  fistHoldFrames: number;
  /** Frames open hand required before another fist can click. */
  openFramesRequired: number;
  /** Minimum ms between emitted clicks. */
  cooldownMs: number;
  /**
   * Non-fist frames that can interrupt a closing fist without cancelling it.
   * A partial curl is open the whole time, so it still never clicks.
   */
  maxFistGapFrames: number;
}

export const DEFAULT_FIST_CLICK_GATE: FistClickGateConfig = {
  fistHoldFrames: 3,
  openFramesRequired: 4,
  cooldownMs: 900,
  maxFistGapFrames: 1,
};

/**
 * Emits at most one click per deliberate fist: requires open hand between clicks.
 */
export class FistClickGate {
  private fistFrames = 0;
  private fistGap = 0;
  private openFrames = 0;
  private armed = true;
  private lastClickAt = 0;

  constructor(private readonly config: FistClickGateConfig = DEFAULT_FIST_CLICK_GATE) {}

  reset(): void {
    this.fistFrames = 0;
    this.fistGap = 0;
    this.openFrames = 0;
    this.armed = true;
    this.lastClickAt = 0;
  }

  /** Returns true once when a debounced fist click should fire. */
  update(isFist: boolean, now = performance.now()): boolean {
    if (isFist) {
      this.fistFrames += 1;
      this.fistGap = 0;
      this.openFrames = 0;
    } else {
      const preserveClosingFist =
        this.armed && this.fistFrames > 0 && this.fistGap < this.config.maxFistGapFrames;
      if (preserveClosingFist) {
        this.fistGap += 1;
        return false;
      }
      this.fistFrames = 0;
      this.fistGap = 0;
      this.openFrames += 1;
      if (this.openFrames >= this.config.openFramesRequired) {
        this.armed = true;
      }
      return false;
    }

    if (!this.armed) return false;
    if (this.fistFrames < this.config.fistHoldFrames) return false;
    if (this.lastClickAt > 0 && now - this.lastClickAt < this.config.cooldownMs) return false;

    this.lastClickAt = now;
    this.armed = false;
    this.fistFrames = 0;
    this.fistGap = 0;
    return true;
  }
}
