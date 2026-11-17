import { VISION_CONFIG } from '../config';
import { POSE_LANDMARK_INDEX } from './landmarks';

interface ImagePoint {
  x: number;
  y: number;
}

/**
 * Where a body sits in the frame and how big it looks, from the shoulders and hips.
 * Units are frame heights: x is scaled by the frame aspect so both axes measure the same.
 */
export interface BodyFootprint {
  /** Torso centre. */
  x: number;
  y: number;
  /** Body size: the largest of shoulder width, hip width and shoulder-to-hip length. */
  size: number;
}

/** A body smaller than this (frame heights) cannot be measured or followed. */
export const MIN_BODY_SIZE = 1e-3;

export type PersonLockOptions = typeof VISION_CONFIG.personLock;

function torsoPoint(
  landmarks: readonly ImagePoint[],
  index: number,
  aspect: number,
): ImagePoint | null {
  const landmark = landmarks[index];
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
  return { x: landmark.x * aspect, y: landmark.y };
}

function midpoint(a: ImagePoint, b: ImagePoint): ImagePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: ImagePoint, b: ImagePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Frame width / height, or 1 when unknown. */
export function safeAspect(aspect: number | undefined): number {
  return typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

/**
 * The body's torso centre and size. Uses the shoulder and hip landmarks, which MediaPipe
 * places even when they are hidden or out of frame. Null when any of them is missing.
 */
export function bodyFootprint(
  landmarks: readonly ImagePoint[] | null | undefined,
  aspect = 1,
): BodyFootprint | null {
  if (!landmarks?.length) return null;
  const scale = safeAspect(aspect);
  const leftShoulder = torsoPoint(landmarks, POSE_LANDMARK_INDEX.leftShoulder, scale);
  const rightShoulder = torsoPoint(landmarks, POSE_LANDMARK_INDEX.rightShoulder, scale);
  const leftHip = torsoPoint(landmarks, POSE_LANDMARK_INDEX.leftHip, scale);
  const rightHip = torsoPoint(landmarks, POSE_LANDMARK_INDEX.rightHip, scale);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const shoulders = midpoint(leftShoulder, rightShoulder);
  const hips = midpoint(leftHip, rightHip);
  const centre = midpoint(shoulders, hips);
  return {
    x: centre.x,
    y: centre.y,
    size: Math.max(distance(leftShoulder, rightShoulder), distance(leftHip, rightHip), distance(shoulders, hips)),
  };
}

function trackable(footprint: BodyFootprint | null): BodyFootprint | null {
  return footprint && Number.isFinite(footprint.size) && footprint.size >= MIN_BODY_SIZE ? footprint : null;
}

/**
 * Keeps the skeleton on one person. The first pick is the biggest body nearest the middle of
 * the frame. From then on only that person is returned, followed frame to frame by where their
 * torso is and how big it looks. While they are missing (hidden, or tracking dropped) nobody is
 * returned. Once they have been missing for `releaseMs` they count as gone and the next
 * person is picked.
 *
 * MediaPipe gives no identity, so this is position-based: someone who steps into the same spot
 * at the same size while the person is hidden can take over.
 */
export class PoseTargetLock {
  private target: BodyFootprint | null = null;
  private lastSeenAt = 0;

  constructor(private readonly options: PersonLockOptions = VISION_CONFIG.personLock) {}

  isLocked(): boolean {
    return this.target !== null;
  }

  /**
   * Index of the locked person among this frame's bodies, or null when they are not in it.
   * `timestamp` is in milliseconds and must come from one clock.
   */
  select(
    bodies: readonly (readonly ImagePoint[])[],
    timestamp: number,
    aspect = 1,
  ): number | null {
    if (!Number.isFinite(timestamp)) return null;
    const ratio = safeAspect(aspect);
    const footprints = bodies.map((body) => trackable(bodyFootprint(body, ratio)));

    if (this.target) {
      const missingMs = timestamp - this.lastSeenAt;
      // A clock that went backwards cannot say how long the person was gone.
      if (missingMs < 0 || missingMs > this.options.releaseMs) this.target = null;
    }

    const index = this.target
      ? this.follow(footprints, timestamp - this.lastSeenAt)
      : this.pickFirst(footprints, ratio);
    if (index === null) return null;
    this.target = footprints[index]!;
    this.lastSeenAt = timestamp;
    return index;
  }

  /** Forget the locked person. The next body seen is picked fresh. */
  reset(): void {
    this.target = null;
    this.lastSeenAt = 0;
  }

  private follow(footprints: readonly (BodyFootprint | null)[], missingMs: number): number | null {
    const target = this.target!;
    const { maxStepBodySizes, reachGrowthPerSecond, maxReachBodySizes, maxSizeRatio } = this.options;
    const reachSizes = Math.min(
      Math.max(maxStepBodySizes, maxReachBodySizes),
      maxStepBodySizes + (reachGrowthPerSecond * missingMs) / 1000,
    );
    const reach = reachSizes * target.size;

    let best: number | null = null;
    let bestCost = Infinity;
    footprints.forEach((footprint, index) => {
      if (!footprint) return;
      const sizeRatio = footprint.size / target.size;
      if (sizeRatio > maxSizeRatio || sizeRatio < 1 / maxSizeRatio) return;
      const moved = distance(footprint, target);
      if (moved > reach) return;
      const cost = moved / target.size + Math.abs(Math.log(sizeRatio));
      if (cost < bestCost) {
        bestCost = cost;
        best = index;
      }
    });
    return best;
  }

  private pickFirst(footprints: readonly (BodyFootprint | null)[], aspect: number): number | null {
    const edgeWeight = Math.max(0, this.options.edgePenalty - 1);
    let best: number | null = null;
    let bestScore = -Infinity;
    footprints.forEach((footprint, index) => {
      if (!footprint) return;
      // 0 at the centre, 1 at (or past) the left or right edge.
      const offCentre = Math.min(1, Math.abs(footprint.x / aspect - 0.5) * 2);
      const score = footprint.size / (1 + edgeWeight * offCentre);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    return best;
  }
}
