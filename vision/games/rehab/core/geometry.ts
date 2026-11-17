import type { PoseLandmark } from '../../../types';

/**
 * Image-space point. y is the normalized image y (down is positive, 1 = frame
 * height). x is the normalized image x times the frame aspect, so x and y share
 * one unit (frame height) and angles and distances are true to the picture.
 * Camera orientation, not mirrored: the patient's left side has the larger x
 * when they face the camera.
 */
export interface P2 {
  x: number;
  y: number;
}

/** An axis-aligned area of the camera picture, in image units (see `toImage`). */
export interface ImageBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe pose landmark indices used by the rehab games. */
export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lIndex: 19,
  rIndex: 20,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lFoot: 31,
  rFoot: 32,
} as const;

export type Side = 'left' | 'right';
export const SIDES: readonly Side[] = ['left', 'right'];

/** Landmark indices of one side of the body. */
export function sideIdx(side: Side) {
  const l = side === 'left';
  return {
    shoulder: l ? LM.lShoulder : LM.rShoulder,
    elbow: l ? LM.lElbow : LM.rElbow,
    wrist: l ? LM.lWrist : LM.rWrist,
    index: l ? LM.lIndex : LM.rIndex,
    hip: l ? LM.lHip : LM.rHip,
    knee: l ? LM.lKnee : LM.rKnee,
    ankle: l ? LM.lAnkle : LM.rAnkle,
    heel: l ? LM.lHeel : LM.rHeel,
    foot: l ? LM.lFoot : LM.rFoot,
  };
}

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

export function toImage(lm: PoseLandmark, aspect: number): P2 {
  return { x: lm.x * aspect, y: lm.y };
}

export function mid(a: P2, b: P2): P2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a: P2, b: P2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist3(a: V3, b: V3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const DEG = 180 / Math.PI;

/**
 * Angle in degrees between the vector from → to and the vertical, 0..180.
 * `up` measures against straight up (image y decreasing), otherwise straight down.
 */
export function angleFromVertical(from: P2, to: P2, up: boolean): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const cos = (up ? -dy : dy) / len;
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
}

/** Tilt of the line a–b against horizontal, 0..90 degrees. */
export function tiltFromHorizontal(a: P2, b: P2): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < 1e-9 && dy < 1e-9) return 0;
  return Math.atan2(dy, dx) * DEG;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Which image x direction is lateral (away from the midline) for a side.
 * Uses the hips, so it works whichever way the patient faces.
 */
export function lateralSign(points: readonly P2[], side: Side): number {
  const dir = points[LM.lHip].x - points[LM.rHip].x >= 0 ? 1 : -1;
  return side === 'left' ? dir : -dir;
}
