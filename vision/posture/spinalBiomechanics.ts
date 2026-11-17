import { POSE_LANDMARK_INDEX } from '../pose/landmarks';
import type { PoseLandmark } from '../types';

/**
 * Spine geometry for the deadlift back check, in the camera plane (x × aspect, y) unless noted.
 * These are camera estimates from keypoints, not radiographic measurements.
 */

const RAD_TO_DEG = 180 / Math.PI;

export interface PlanePoint {
  x: number;
  y: number;
}

export interface SagittalCorrectionConfig {
  /** Past this yaw the view is not corrected: the side-view check deals with it. */
  maxYawDeg: number;
  /** Hip-joint separation in the world landmarks, in metres, outside which the yaw is not trusted. */
  minHipWidthM: number;
  maxHipWidthM: number;
}

function unit(v: PlanePoint): PlanePoint | null {
  const length = Math.hypot(v.x, v.y);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return { x: v.x / length, y: v.y / length };
}

/** Square to `up` in the image plane. Which of the two directions does not matter to its users. */
function across(up: PlanePoint): PlanePoint | null {
  const u = unit(up);
  return u ? { x: -u.y, y: u.x } : null;
}

/**
 * Signed turn at `b` along a → b → c, in degrees. 0 when the three points are in a line. Positive
 * when `b` sits out of the back from the a–c line (away from `chest`), as when the back rounds.
 * Null when two of the points coincide.
 */
export function threePointTurnDeg(a: PlanePoint, b: PlanePoint, c: PlanePoint, chest: PlanePoint): number | null {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  if (Math.hypot(ux, uy) < 1e-9 || Math.hypot(vx, vy) < 1e-9) return null;
  const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * RAD_TO_DEG;
  const chordX = c.x - a.x;
  const chordY = c.y - a.y;
  const chord2 = chordX * chordX + chordY * chordY;
  if (chord2 < 1e-18) return null;
  // b's offset from its foot on the a–c line.
  const along = (ux * chordX + uy * chordY) / chord2;
  const offX = ux - along * chordX;
  const offY = uy - along * chordY;
  const towardChest = offX * chest.x + offY * chest.y;
  return towardChest > 0 ? -turn : turn;
}

/**
 * Angle of from → to against `up`, in degrees. Positive when it leans toward `forward`.
 * Null when the segment or the axes are degenerate.
 */
export function tiltFromUpDeg(from: PlanePoint, to: PlanePoint, up: PlanePoint, forward: PlanePoint): number | null {
  const segment = unit({ x: to.x - from.x, y: to.y - from.y });
  const upUnit = unit(up);
  if (!segment || !upUnit) return null;
  const cos = Math.max(-1, Math.min(1, segment.x * upUnit.x + segment.y * upUnit.y));
  const angle = Math.acos(cos) * RAD_TO_DEG;
  const side = across(upUnit)!;
  const forwardSide = forward.x * side.x + forward.y * side.y;
  if (Math.abs(forwardSide) < 1e-9) return angle;
  const segmentSide = segment.x * side.x + segment.y * side.y;
  return segmentSide * forwardSide >= 0 ? angle : -angle;
}

/**
 * Which way is forward across the image: the chest's direction and the hip → shoulder line both
 * point that way once the up component is taken out. Upright, the chest carries it; hinged flat,
 * the trunk does.
 */
export function forwardAcrossImage(chest: PlanePoint, hip: PlanePoint, shoulder: PlanePoint, up: PlanePoint): PlanePoint {
  const side = across(up);
  if (!side) return chest;
  const trunk = unit({ x: shoulder.x - hip.x, y: shoulder.y - hip.y }) ?? { x: 0, y: 0 };
  const amount = (chest.x + trunk.x) * side.x + (chest.y + trunk.y) * side.y;
  return { x: side.x * Math.sign(amount || 1), y: side.y * Math.sign(amount || 1) };
}

function worldPoint(mark: PoseLandmark | undefined): { x: number; y: number; z: number } | null {
  if (!mark || !Number.isFinite(mark.x) || !Number.isFinite(mark.y) || !Number.isFinite(mark.z)) return null;
  return { x: mark.x, y: mark.y, z: mark.z };
}

/**
 * How far the body is turned from a true side view, in degrees, from MediaPipe's 3D world
 * landmarks. Side-on, the hip axis runs straight away from the camera; turned, part of it shows
 * across the image. 0 is side-on. Null without world landmarks or with an implausible hip width.
 */
export function bodyYawDeg(
  world: readonly PoseLandmark[] | undefined,
  up: PlanePoint,
  config: SagittalCorrectionConfig,
): number | null {
  if (!world || world.length < 33) return null;
  const left = worldPoint(world[POSE_LANDMARK_INDEX.leftHip]);
  const right = worldPoint(world[POSE_LANDMARK_INDEX.rightHip]);
  const side = across(up);
  if (!left || !right || !side) return null;
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const sideways = dx * side.x + dy * side.y;
  const depth = right.z - left.z;
  const width = Math.hypot(sideways, depth);
  if (width < config.minHipWidthM || width > config.maxHipWidthM) return null;
  return Math.atan2(Math.abs(sideways), Math.abs(depth)) * RAD_TO_DEG;
}

/**
 * How much to stretch the image across `up` to undo the camera's foreshortening of the body's
 * sagittal plane: 1 / cos(yaw). Upright bends run across the image and read short when the body is
 * turned; hinged, the trunk itself does. Uncorrected, that bias reads as a change in shape between
 * standing and hinging. 1 when the yaw is unknown or past the limit.
 */
export function sagittalStretch(yawDeg: number | null, maxYawDeg: number): number {
  if (yawDeg === null || !Number.isFinite(yawDeg) || yawDeg < 0 || yawDeg > maxYawDeg) return 1;
  return 1 / Math.cos(yawDeg / RAD_TO_DEG);
}

/** Stretch a point's component across `up` by `factor`, about `origin`. */
export function stretchAcrossUp(point: PlanePoint, origin: PlanePoint, up: PlanePoint, factor: number): PlanePoint {
  const side = across(up);
  if (!side || factor === 1) return { x: point.x, y: point.y };
  const amount = (point.x - origin.x) * side.x + (point.y - origin.y) * side.y;
  return { x: point.x + side.x * amount * (factor - 1), y: point.y + side.y * amount * (factor - 1) };
}

/** Stretch a direction the same way and return it at unit length. */
export function stretchDirection(direction: PlanePoint, up: PlanePoint, factor: number): PlanePoint {
  const moved = stretchAcrossUp(direction, { x: 0, y: 0 }, up, factor);
  return unit(moved) ?? direction;
}

/**
 * Hip → shoulder midpoints against `up` in MediaPipe's 3D world landmarks, in degrees. 0 is upright.
 * Unlike the camera-plane lean it does not shrink when the body turns toward the camera.
 * Null without world landmarks or when the torso length is not a body's.
 */
export function trunkInclination3dDeg(
  world: readonly PoseLandmark[] | undefined,
  up: PlanePoint,
  torsoLengthM: { min: number; max: number },
): number | null {
  if (!world || world.length < 33) return null;
  const marks = (['leftHip', 'rightHip', 'leftShoulder', 'rightShoulder'] as const).map((name) =>
    worldPoint(world[POSE_LANDMARK_INDEX[name]]),
  );
  if (marks.some((mark) => !mark)) return null;
  const [lh, rh, ls, rs] = marks as { x: number; y: number; z: number }[];
  const v = {
    x: (ls!.x + rs!.x - lh!.x - rh!.x) / 2,
    y: (ls!.y + rs!.y - lh!.y - rh!.y) / 2,
    z: (ls!.z + rs!.z - lh!.z - rh!.z) / 2,
  };
  const length = Math.hypot(v.x, v.y, v.z);
  if (length < torsoLengthM.min || length > torsoLengthM.max) return null;
  const upUnit = unit(up);
  if (!upUnit) return null;
  const cos = Math.max(-1, Math.min(1, (v.x * upUnit.x + v.y * upUnit.y) / length));
  return Math.acos(cos) * RAD_TO_DEG;
}
