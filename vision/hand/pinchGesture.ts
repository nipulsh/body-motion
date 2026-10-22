import type { HandLandmark2D } from './fistGesture';
import { HAND_POINTER_SENSITIVITY, palmCenter } from './handPointer';

const WRIST = 0;
const THUMB_TIP = 4;
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
 * Same curl test as a fist: the tip has come back to its knuckle.
 * 1 is the knuckle-to-middle-joint length.
 */
const FINGER_CURL_RATIO = 1.3;

/** Thumb tip and index tip must sit within this multiple of palm size. */
const PINCH_TIP_RATIO = 0.5;

/** Ignore hand jitter smaller than this, in normalized camera units. */
export const PINCH_DRAG_DEADZONE = 0.01;

/** Ignore two-hand span changes smaller than this fraction. */
export const PINCH_ZOOM_DEADZONE = 0.04;

const OPEN_FINGERS: readonly { tip: number; pip: number; mcp: number }[] = [
  { tip: MIDDLE_TIP, pip: MIDDLE_PIP, mcp: MIDDLE_MCP },
  { tip: RING_TIP, pip: RING_PIP, mcp: RING_MCP },
  { tip: PINKY_TIP, pip: PINKY_PIP, mcp: PINKY_MCP },
];

export interface PinchHand {
  landmarks: readonly HandLandmark2D[];
}

export interface PinchPoint {
  x: number;
  y: number;
}

export interface PinchDrag {
  dx: number;
  dy: number;
}

export interface PinchFrame {
  pinching: boolean;
  /** Palm of the pinched hand, in normalized camera space. */
  palm: PinchPoint | null;
  /** Movement since the last emitted drag. Null when still or while zooming. */
  drag: PinchDrag | null;
  /** >1 zooms in (hands apart), <1 zooms out (hands together). */
  zoom: number | null;
}

function dist(a: PinchPoint, b: PinchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

/**
 * Thumb tip and index tip together, with the middle, ring, and little fingers open.
 * A fist fails because those fingers are curled.
 */
export function isPinchGesture(landmarks: readonly HandLandmark2D[]): boolean {
  if (landmarks.length < 21) return false;

  const scale = dist(landmarks[WRIST]!, landmarks[MIDDLE_MCP]!);
  if (scale < 0.02) return false;

  const tipsTogether = dist(landmarks[THUMB_TIP]!, landmarks[INDEX_TIP]!) <= scale * PINCH_TIP_RATIO;
  if (!tipsTogether) return false;

  return OPEN_FINGERS.every(
    (finger) => !fingerCurled(landmarks, finger.tip, finger.pip, finger.mcp),
  );
}

/**
 * Map a normalized camera-space drag into selfie-mirror viewport pixels.
 * Camera +X is the user's left, so horizontal motion is flipped.
 */
export function pinchDragToViewport(
  drag: PinchDrag,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  if (viewportWidth <= 0 || viewportHeight <= 0) return { x: 0, y: 0 };
  return {
    x: -drag.dx * HAND_POINTER_SENSITIVITY * viewportWidth,
    y: drag.dy * HAND_POINTER_SENSITIVITY * viewportHeight,
  };
}

/**
 * One pinched hand drags. A second hand, while that pinch is held, zooms from
 * the distance between the palms. Two open hands do nothing.
 */
export class PinchManipulator {
  private lastPalm: PinchPoint | null = null;
  private pending = { x: 0, y: 0 };
  private lastSpan: number | null = null;

  reset(): void {
    this.lastPalm = null;
    this.pending = { x: 0, y: 0 };
    this.lastSpan = null;
  }

  update(hands: readonly PinchHand[]): PinchFrame {
    const usable = hands.filter((hand) => palmCenter(hand.landmarks));
    const pinchHand = usable.find((hand) => isPinchGesture(hand.landmarks));
    if (!pinchHand) {
      this.reset();
      return { pinching: false, palm: null, drag: null, zoom: null };
    }

    const palm = palmCenter(pinchHand.landmarks)!;
    const other = usable.find((hand) => hand !== pinchHand);
    const otherPalm = other ? palmCenter(other.landmarks) : null;
    if (otherPalm) {
      this.lastPalm = palm;
      this.pending = { x: 0, y: 0 };
      return { pinching: true, palm, drag: null, zoom: this.zoomFromSpan(dist(palm, otherPalm)) };
    }

    this.lastSpan = null;
    return { pinching: true, palm, drag: this.dragFromPalm(palm), zoom: null };
  }

  private dragFromPalm(palm: PinchPoint): PinchDrag | null {
    if (!this.lastPalm) {
      this.lastPalm = palm;
      return null;
    }

    this.pending.x += palm.x - this.lastPalm.x;
    this.pending.y += palm.y - this.lastPalm.y;
    this.lastPalm = palm;

    if (Math.hypot(this.pending.x, this.pending.y) < PINCH_DRAG_DEADZONE) return null;

    const drag = { dx: this.pending.x, dy: this.pending.y };
    this.pending = { x: 0, y: 0 };
    return drag;
  }

  private zoomFromSpan(span: number): number | null {
    if (!(span > 0.02)) return null;
    if (this.lastSpan == null) {
      this.lastSpan = span;
      return null;
    }

    const ratio = span / this.lastSpan;
    if (Math.abs(ratio - 1) < PINCH_ZOOM_DEADZONE) return null;

    this.lastSpan = span;
    return ratio;
  }
}
