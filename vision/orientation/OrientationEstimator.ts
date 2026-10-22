import { getLandmark } from '../pose/landmarks';
import type { PoseLandmarkName } from '../pose/landmarks';
import { VISION_CONFIG } from '../config';
import {
  circularEma,
  normalizeDegrees,
  shortestAngleDiff,
  wrapSigned180,
} from '../math/angles';
import type {
  FacingDirection,
  OrientationResult,
  PoseLandmark,
  PoseMetrics,
  PoseResult,
  Vec3,
} from '../types';

const DIRECTIONS: readonly FacingDirection[] = [
  'front',
  'front_right',
  'right',
  'back_right',
  'back',
  'back_left',
  'left',
  'front_left',
];

const FACE_LANDMARKS = ['nose', 'leftEye', 'rightEye'] as const;

export interface OrientationEstimatorLike {
  update(pose: PoseResult, metrics: PoseMetrics): OrientationResult;
  reset(): void;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function meanVisibility(
  landmarks: readonly PoseLandmark[],
  names: readonly PoseLandmarkName[],
): number {
  let sum = 0;
  let count = 0;
  for (const name of names) {
    const lm = getLandmark(landmarks, name);
    if (!lm) continue;
    sum += lm.visibility;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Camera-space yaw from IMAGE landmarks (not world landmarks).
 *
 * MediaPipe image coords: x right, y down, z smaller when closer to camera.
 * Unmirrored webcam, person facing the lens: the person's LEFT shoulder is on
 * the RIGHT of the image (leftShoulder.x > rightShoulder.x).
 *
 * Converted to camera space (+X image-right, +Y up, +Z toward camera):
 *      right   = rightShoulder - leftShoulder   // points toward image-left when facing
 *      up      = shoulderMid - hipMid (or +Y if hips are unreliable)
 *      forward = up × right                     // +Z when facing the camera
 *      signedYaw = atan2(forward.x, forward.z)  ∈ (-180, 180]
 *
 * 0° = facing camera, +90° = person's right profile, ±180° = back, -90° = left.
 *
 * Why this stalled at 170–180° in the live scan:
 * 1) World landmarks were preferred. Their X axis follows the person, not the
 *    camera, so heading did not advance as the user turned — it sat near 180°.
 * 2) `right × up` on unmirrored image landmarks also yields 180° when facing
 *    the camera (person's left is image-right). Combined with a nose-based
 *    180° flip, the heading oscillated around 170–180° and RotationTracker
 *    rejected the 180° teleports. Capture uses cumulative rotation, so images
 *    froze around 20/36 (the 180° / 190° sector).
 * 3) Close-up bust shots made hips invisible. The old code then returned null
 *    and reused the last yaw, freezing both the degree counter and capture.
 */
function imageToCamera(lm: PoseLandmark): Vec3 {
  return {
    x: lm.x - 0.5,
    y: 0.5 - lm.y,
    z: -lm.z,
  };
}

function hipsReliable(leftHip: PoseLandmark, rightHip: PoseLandmark): boolean {
  const minVis = VISION_CONFIG.quality.minimumVisibilityConfidence;
  return leftHip.visibility >= minVis && rightHip.visibility >= minVis;
}

function torsoForward(imageLandmarks: readonly PoseLandmark[]): Vec3 | null {
  const leftShoulder = getLandmark(imageLandmarks, 'leftShoulder');
  const rightShoulder = getLandmark(imageLandmarks, 'rightShoulder');
  if (!leftShoulder || !rightShoulder) return null;

  const ls = imageToCamera(leftShoulder);
  const rs = imageToCamera(rightShoulder);
  const right = sub(rs, ls);
  const shoulderMid = scale(add(ls, rs), 0.5);

  const leftHip = getLandmark(imageLandmarks, 'leftHip');
  const rightHip = getLandmark(imageLandmarks, 'rightHip');
  let up: Vec3 = { x: 0, y: 1, z: 0 };
  if (leftHip && rightHip && hipsReliable(leftHip, rightHip)) {
    const hipMid = scale(add(imageToCamera(leftHip), imageToCamera(rightHip)), 0.5);
    up = sub(shoulderMid, hipMid);
    if (up.y < 0) up = scale(up, -1);
  }

  const forward = cross(up, right);
  if (length(forward) < 1e-6) return null;
  return forward;
}

export function yawFromForward(forward: Vec3): number {
  return wrapSigned180((Math.atan2(forward.x, forward.z) * 180) / Math.PI);
}

export function directionFromYaw(yawDeg: number): FacingDirection {
  const idx = Math.round(normalizeDegrees(yawDeg) / 45) % 8;
  const direction = DIRECTIONS[idx];
  return direction ?? 'front';
}

function directionCenter(direction: FacingDirection): number {
  switch (direction) {
    case 'front':
      return 0;
    case 'front_right':
      return 45;
    case 'right':
      return 90;
    case 'back_right':
      return 135;
    case 'back':
      return 180;
    case 'back_left':
      return 225;
    case 'left':
      return 270;
    case 'front_left':
      return 315;
    default: {
      const _never: never = direction;
      return _never;
    }
  }
}

export class OrientationEstimator implements OrientationEstimatorLike {
  private smoothedYaw: number | null = null;
  private direction: FacingDirection = 'front';

  update(pose: PoseResult, _metrics: PoseMetrics): OrientationResult {
    const forward = torsoForward(pose.landmarks);
    if (!forward) {
      const fallback = this.smoothedYaw ?? 0;
      return {
        yawDeg: fallback,
        rawYawDeg: fallback,
        normalizedAngle: normalizeDegrees(fallback),
        direction: this.direction,
        confidence: 0,
      };
    }

    const rawYaw = yawFromForward(forward);
    const alpha = VISION_CONFIG.motion.orientationSmoothingAlpha;
    const isFirst = this.smoothedYaw === null;
    this.smoothedYaw =
      this.smoothedYaw === null ? rawYaw : circularEma(this.smoothedYaw, rawYaw, alpha);

    const candidate = directionFromYaw(this.smoothedYaw);
    const fromCenter = shortestAngleDiff(directionCenter(this.direction), this.smoothedYaw);
    const switchAt = 22.5 + VISION_CONFIG.motion.orientationHysteresisDeg;
    if (isFirst || (candidate !== this.direction && fromCenter > switchAt)) {
      this.direction = candidate;
    }

    const leftShoulder = getLandmark(pose.landmarks, 'leftShoulder');
    const rightShoulder = getLandmark(pose.landmarks, 'rightShoulder');
    const vis =
      ([leftShoulder, rightShoulder].reduce((s, lm) => s + (lm?.visibility ?? 0), 0) / 2) || 0;
    const formed = Math.min(1, length(forward) * 8);
    const faceScore = meanVisibility(pose.landmarks, FACE_LANDMARKS);
    const faceBoost = faceScore >= VISION_CONFIG.quality.minimumVisibilityConfidence ? 0 : 0.08;
    const confidence = Math.max(0, Math.min(1, vis * formed - faceBoost));

    return {
      yawDeg: this.smoothedYaw,
      rawYawDeg: rawYaw,
      normalizedAngle: normalizeDegrees(this.smoothedYaw),
      direction: this.direction,
      confidence,
    };
  }

  reset(): void {
    this.smoothedYaw = null;
    this.direction = 'front';
  }
}
