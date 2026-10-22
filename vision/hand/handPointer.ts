export interface NormalizedPoint {
  x: number;
  y: number;
}

/** MediaPipe hand landmark index for index fingertip. */
export const INDEX_FINGER_TIP = 8;

/** Wrist + MCP joints — the palm, not the fingers. */
export const PALM_LANDMARK_INDICES = [0, 5, 9, 13, 17] as const;

/**
 * Camera motion → screen motion. 1 maps the full frame; values above 1 make a
 * smaller hand movement cover the whole viewport (2.6 ≈ center 38% of the frame).
 */
export const HAND_POINTER_SENSITIVITY = 2.6;

export interface HandPointToViewportOptions {
  mirrorX?: boolean;
  sensitivity?: number;
}

/**
 * Average of wrist and knuckle landmarks so the cursor follows the palm
 * instead of a fingertip (which jumps when making a fist).
 */
export function palmCenter(landmarks: readonly NormalizedPoint[]): NormalizedPoint | null {
  let x = 0;
  let y = 0;
  for (const index of PALM_LANDMARK_INDICES) {
    const point = landmarks[index];
    if (!point) return null;
    x += point.x;
    y += point.y;
  }
  const count = PALM_LANDMARK_INDICES.length;
  return { x: x / count, y: y / count };
}

function amplifyNorm(value: number, sensitivity: number): number {
  return Math.min(1, Math.max(0, 0.5 + (value - 0.5) * sensitivity));
}

/**
 * Map a normalized camera landmark to viewport pixels.
 * `mirrorX` matches a user-facing webcam (selfie) so the pointer follows the user naturally.
 */
export function handPointToViewport(
  landmark: NormalizedPoint,
  viewportWidth: number,
  viewportHeight: number,
  options: HandPointToViewportOptions = {},
): { x: number; y: number } {
  const mirrorX = options.mirrorX ?? true;
  const sensitivity = options.sensitivity ?? HAND_POINTER_SENSITIVITY;
  const xNorm = amplifyNorm(mirrorX ? 1 - landmark.x : landmark.x, sensitivity);
  const yNorm = amplifyNorm(landmark.y, sensitivity);

  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: xNorm * viewportWidth,
    y: yNorm * viewportHeight,
  };
}
