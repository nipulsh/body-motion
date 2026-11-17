import type { PoseLandmark } from '../types';
import { getLandmark, POSE_LANDMARK_INDEX, POSE_LANDMARK_NAMES, type PoseLandmarkName } from './landmarks';
import {
  cameraToBody,
  distanceFromSeparation,
  type FrameSize,
  type MirrorGeometry,
  type MirrorPoint,
} from './mirrorReflection';
import { isLandmarkVisible, WIREFRAME_MIN_VISIBILITY, type Point2D } from './wireframe';

/** Eye (and stand-in head) landmarks below this score are treated as unreliable. */
export const EYE_MIN_VISIBILITY = 0.5;

/** Midpoint of the reliable landmarks among `names`, in normalized image coordinates, or null. */
function reliableMidpoint(
  landmarks: readonly PoseLandmark[],
  names: readonly PoseLandmarkName[],
  minVisibility: number,
): Point2D | null {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const name of names) {
    const landmark = getLandmark(landmarks, name);
    if (!isLandmarkVisible(landmark, minVisibility)) continue;
    x += landmark!.x;
    y += landmark!.y;
    count += 1;
  }
  return count > 0 ? { x: x / count, y: y / count } : null;
}

/** Midpoint of the reliable eyes in normalized image coordinates, or null. */
export function eyeImagePoint(
  landmarks: readonly PoseLandmark[] | null | undefined,
  minVisibility: number = EYE_MIN_VISIBILITY,
): Point2D | null {
  if (!landmarks?.length) return null;
  return reliableMidpoint(landmarks, ['leftEye', 'rightEye'], minVisibility);
}

/**
 * Which way the body points on screen, from the ankles (or knees, or hips) up to the shoulders,
 * snapped to the nearest screen edge direction: (0, -1) is screen up. Screen pixels with y down;
 * `mirrorX` matches a mirrored picture. Null when the shoulders or a base below them are not seen.
 * Works whichever way the camera is turned, since it reads the body, not the camera.
 */
export function bodyUpOnScreen(
  landmarks: readonly PoseLandmark[] | null | undefined,
  frame: FrameSize | null | undefined,
  mirrorX: boolean,
  minVisibility: number = EYE_MIN_VISIBILITY,
): Point2D | null {
  if (!landmarks?.length) return null;
  const top = reliableMidpoint(landmarks, ['leftShoulder', 'rightShoulder'], minVisibility);
  if (!top) return null;
  const base =
    reliableMidpoint(landmarks, ['leftAnkle', 'rightAnkle'], minVisibility) ??
    reliableMidpoint(landmarks, ['leftKnee', 'rightKnee'], minVisibility) ??
    reliableMidpoint(landmarks, ['leftHip', 'rightHip'], minVisibility);
  if (!base) return null;
  const width = frame && frame.width > 0 ? frame.width : 1;
  const height = frame && frame.height > 0 ? frame.height : 1;
  const dx = (top.x - base.x) * width * (mirrorX ? -1 : 1);
  const dy = (top.y - base.y) * height;
  if (Math.hypot(dx, dy) <= 1e-9) return null;
  return Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

/** Typical adult rise from a stand-in landmark up to eye level, in inches. */
const NOSE_TO_EYE_IN = 1.5;
const SHOULDERS_TO_EYE_IN = 9;

const EYE_SOURCES: ReadonlyArray<readonly [readonly PoseLandmarkName[], number]> = [
  [['leftEye', 'rightEye'], 0],
  [['leftEar', 'rightEar'], 0],
  [['nose'], NOSE_TO_EYE_IN],
  [['leftShoulder', 'rightShoulder'], SHOULDERS_TO_EYE_IN],
];

/**
 * The viewer's eye position on the body plane. Uses the eyes when reliable;
 * otherwise the ears (at eye level), the nose, or the shoulders, so looking
 * down in a squat does not lose the viewpoint. Null only when none is reliable.
 */
export function estimateEyeBody(
  landmarks: readonly PoseLandmark[] | null | undefined,
  frame: FrameSize,
  geometry: MirrorGeometry,
  distanceIn: number,
  minVisibility: number = EYE_MIN_VISIBILITY,
): MirrorPoint | null {
  if (!landmarks?.length) return null;
  for (const [names, lift] of EYE_SOURCES) {
    // Both shoulders are needed: one shoulder is not centered on the head.
    if (names.length === 2 && names[0] === 'leftShoulder') {
      const both = names.every((name) => isLandmarkVisible(getLandmark(landmarks, name), minVisibility));
      if (!both) continue;
    }
    const image = reliableMidpoint(landmarks, names, minVisibility);
    const body = image ? cameraToBody(image, frame, geometry, distanceIn) : null;
    if (body) return { x: body.x, h: body.h + lift };
  }
  return null;
}

export interface EyePositionTrackerOptions {
  /** Time constant of the eye low-pass filter. */
  smoothingMs?: number;
  /** How long the last eye position is held when no estimate exists (nobody in view). */
  holdMs?: number;
  /** Time constant used to ease the eye height back to the default after the hold. */
  releaseMs?: number;
  /** After this long without an estimate, the next one is a new person and is taken as-is. */
  resetMs?: number;
}

const EYE_DEFAULTS: Required<EyePositionTrackerOptions> = {
  smoothingMs: 120,
  holdMs: 750,
  releaseMs: 600,
  resetMs: 3000,
};

/** Frame gaps longer than this count as one step so a stall cannot jump the filter. */
const MAX_STEP_MS = 250;

function smoothingFactor(dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return 1;
  return 1 - Math.exp(-Math.min(dtMs, MAX_STEP_MS) / tauMs);
}

/**
 * Smoothed viewer eye position (the mirror viewpoint). Starts at `fallback`,
 * takes the first estimate for a new person directly, then follows estimates
 * through a low-pass filter. When no estimate exists it holds the last value,
 * then eases the height back to the fallback.
 */
export class EyePositionTracker {
  private readonly options: Required<EyePositionTrackerOptions>;
  private current: MirrorPoint;
  private lastUpdateAt: number | null = null;
  private lastReliableAt: number | null = null;

  constructor(
    private readonly fallback: MirrorPoint,
    options: EyePositionTrackerOptions = {},
  ) {
    this.options = { ...EYE_DEFAULTS, ...options };
    this.current = { ...fallback };
  }

  get position(): MirrorPoint {
    return this.current;
  }

  update(measured: MirrorPoint | null, nowMs: number): MirrorPoint {
    const dt = this.lastUpdateAt === null ? 0 : Math.max(0, nowMs - this.lastUpdateAt);
    this.lastUpdateAt = nowMs;
    const missingFor = this.lastReliableAt === null ? Infinity : nowMs - this.lastReliableAt;

    if (measured) {
      const k = missingFor >= this.options.resetMs ? 1 : smoothingFactor(dt, this.options.smoothingMs);
      this.lastReliableAt = nowMs;
      this.current = {
        x: this.current.x + (measured.x - this.current.x) * k,
        h: this.current.h + (measured.h - this.current.h) * k,
      };
      return this.current;
    }

    if (missingFor > this.options.holdMs) {
      const k = smoothingFactor(dt, this.options.releaseMs);
      this.current = { x: this.current.x, h: this.current.h + (this.fallback.h - this.current.h) * k };
    }
    return this.current;
  }
}

export interface DistanceTrackerOptions {
  /**
   * Recent window whose closest reading is used. Turning sideways narrows the
   * shoulders in the image, which would otherwise read as stepping back.
   */
  windowMs?: number;
  /** Time constant of the distance low-pass filter. */
  smoothingMs?: number;
  /** Readings outside this range are ignored as bad detections. */
  minIn?: number;
  maxIn?: number;
  /** After this long without shoulders, the next reading is a new person and is taken as-is. */
  resetMs?: number;
}

const DISTANCE_DEFAULTS: Required<DistanceTrackerOptions> = {
  windowMs: 1500,
  smoothingMs: 400,
  minIn: 24,
  maxIn: 120,
  resetMs: 3000,
};

/**
 * Viewer distance from the glass, measured each frame from the shoulder width
 * in the image. Holds the last value when the shoulders are not visible.
 */
export class DistanceTracker {
  private readonly options: Required<DistanceTrackerOptions>;
  private current: number;
  private readings: Array<{ at: number; distanceIn: number }> = [];
  private lastUpdateAt: number | null = null;
  private lastReadingAt: number | null = null;

  constructor(fallbackIn: number, options: DistanceTrackerOptions = {}) {
    this.options = { ...DISTANCE_DEFAULTS, ...options };
    this.current = fallbackIn;
  }

  get distanceIn(): number {
    return this.current;
  }

  update(
    landmarks: readonly PoseLandmark[] | null | undefined,
    frame: FrameSize | null,
    geometry: MirrorGeometry,
    nowMs: number,
  ): number {
    const dt = this.lastUpdateAt === null ? 0 : Math.max(0, nowMs - this.lastUpdateAt);
    this.lastUpdateAt = nowMs;
    const reading = frame && landmarks?.length ? this.read(landmarks, frame, geometry) : null;
    if (reading === null) return this.current;

    const fresh = this.lastReadingAt === null || nowMs - this.lastReadingAt >= this.options.resetMs;
    this.lastReadingAt = nowMs;
    if (fresh) this.readings = [];
    this.readings.push({ at: nowMs, distanceIn: reading });
    this.readings = this.readings.filter((item) => nowMs - item.at <= this.options.windowMs);
    const closest = Math.min(...this.readings.map((item) => item.distanceIn));
    const k = fresh ? 1 : smoothingFactor(dt, this.options.smoothingMs);
    this.current += (closest - this.current) * k;
    return this.current;
  }

  private read(landmarks: readonly PoseLandmark[], frame: FrameSize, geometry: MirrorGeometry): number | null {
    const left = getLandmark(landmarks, 'leftShoulder');
    const right = getLandmark(landmarks, 'rightShoulder');
    if (!isLandmarkVisible(left, EYE_MIN_VISIBILITY) || !isLandmarkVisible(right, EYE_MIN_VISIBILITY)) return null;
    const distanceIn = distanceFromSeparation(left!, right!, geometry.shoulderWidthIn, frame, geometry);
    if (distanceIn === null || distanceIn < this.options.minIn || distanceIn > this.options.maxIn) return null;
    return distanceIn;
  }
}

/**
 * The current person's upright eye height: the highest smoothed eye height
 * seen since they stepped in. Forgotten after `resetMs` with nobody in view.
 */
export class StandingEyeTracker {
  private standing: number | null = null;
  private lastSeenAt: number | null = null;

  constructor(private readonly resetMs = 3000) {}

  /** `eye` is the smoothed eye for a frame that had an estimate, else null. */
  update(eye: MirrorPoint | null, nowMs: number): number | null {
    if (eye) {
      this.standing = this.standing === null ? eye.h : Math.max(this.standing, eye.h);
      this.lastSeenAt = nowMs;
    } else if (this.lastSeenAt !== null && nowMs - this.lastSeenAt >= this.resetMs) {
      this.standing = null;
      this.lastSeenAt = null;
    }
    return this.standing;
  }
}

/** Score margin below the draw floor that a shown landmark may dip before it is hidden. */
export const WIREFRAME_VISIBILITY_HYSTERESIS = 0.08;

/**
 * Per-landmark show/hide with hysteresis, so a joint whose score hovers at the
 * floor does not blink. A landmark appears at `minVisibility` and stays until
 * it drops below `minVisibility - hysteresis`. Absent landmarks are never shown.
 */
export class LandmarkVisibilityGate {
  private shown: boolean[] = [];

  constructor(
    private readonly minVisibility: number = WIREFRAME_MIN_VISIBILITY,
    private readonly hysteresis: number = WIREFRAME_VISIBILITY_HYSTERESIS,
  ) {}

  update(landmarks: readonly PoseLandmark[] | null | undefined): readonly boolean[] {
    if (!landmarks?.length) {
      this.shown = [];
      return this.shown;
    }
    const next: boolean[] = [];
    const exitFloor = Math.max(0, this.minVisibility - this.hysteresis);
    for (const name of POSE_LANDMARK_NAMES) {
      const index = POSE_LANDMARK_INDEX[name];
      const floor = this.shown[index] ? exitFloor : this.minVisibility;
      next[index] = isLandmarkVisible(landmarks[index], floor, name);
    }
    this.shown = next;
    return next;
  }
}
