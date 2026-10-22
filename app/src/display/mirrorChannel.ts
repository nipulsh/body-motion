import type { PoseResult } from '@vision';
import {
  HAND_LANDMARK_COUNT,
  handLandmarkVisibility,
  type TrackedHand,
} from '@vision/hand/handLandmarksBus';

export const MIRROR_POSE_EVENT = 'smart-mirror:pose';
export const MIRROR_EXERCISE_EVENT = 'smart-mirror:exercise';
export const MIRROR_STATUS_EVENT = 'smart-mirror:status';
export const MIRROR_READY_EVENT = 'smart-mirror:ready';
export const MIRROR_POSE_STALE_MS = 500;
export const MIRROR_LANDMARK_COUNT = 33;

export interface MirrorPoseMessage {
  sentAt: number;
  confidence: number;
  frameWidth: number;
  frameHeight: number;
  points: number[];
  /** Each hand is 21 landmarks × (x, y, visibility). Omitted by older senders. */
  hands?: number[][];
}

export interface MirrorExerciseMessage {
  name: string;
  demoVideoUrl: string | null;
  repCount: number;
  targetReps: number;
}

export type DecodedMirrorPose =
  | { kind: 'invalid' }
  | { kind: 'stale' }
  | {
      kind: 'frame';
      pose: PoseResult | null;
      frame: { width: number; height: number } | null;
      hands: TrackedHand[];
    };

function encodeHands(hands: readonly TrackedHand[]): number[][] {
  const encoded: number[][] = [];
  for (const hand of hands) {
    if (encoded.length >= 2 || hand.landmarks.length === 0) continue;
    const points: number[] = [];
    for (let index = 0; index < HAND_LANDMARK_COUNT; index += 1) {
      const landmark = hand.landmarks[index];
      points.push(landmark?.x ?? 0, landmark?.y ?? 0, handLandmarkVisibility(landmark));
    }
    encoded.push(points);
  }
  return encoded;
}

function decodeHands(value: unknown): TrackedHand[] {
  if (!Array.isArray(value)) return [];
  const hands: TrackedHand[] = [];
  for (const entry of value) {
    if (hands.length >= 2) break;
    if (!Array.isArray(entry) || entry.length !== HAND_LANDMARK_COUNT * 3) continue;
    if (entry.some((point) => !isFiniteNumber(point))) continue;
    const landmarks = [];
    for (let index = 0; index < HAND_LANDMARK_COUNT; index += 1) {
      landmarks.push({
        x: entry[index * 3] as number,
        y: entry[index * 3 + 1] as number,
        z: 0,
        visibility: clamp01(entry[index * 3 + 2] as number),
      });
    }
    hands.push({ landmarks, handedness: null });
  }
  return hands;
}

export function encodeMirrorPose(
  pose: PoseResult | null,
  frame: { width: number; height: number } | null,
  sentAt: number,
  hands: readonly TrackedHand[] = [],
): MirrorPoseMessage {
  const landmarks = pose?.landmarks ?? [];
  const points: number[] = [];
  if (landmarks.length >= MIRROR_LANDMARK_COUNT) {
    for (let index = 0; index < MIRROR_LANDMARK_COUNT; index += 1) {
      const landmark = landmarks[index];
      points.push(landmark?.x ?? 0, landmark?.y ?? 0, landmark?.visibility ?? 0);
    }
  }
  return {
    sentAt,
    confidence: pose?.confidence ?? 0,
    frameWidth: frame?.width ?? 0,
    frameHeight: frame?.height ?? 0,
    points,
    hands: encodeHands(hands),
  };
}

export function decodeMirrorPose(input: unknown, now: number): DecodedMirrorPose {
  if (!isRecord(input) || !Array.isArray(input.points)) return { kind: 'invalid' };
  const sentAt = input.sentAt;
  const confidence = input.confidence;
  const frameWidth = input.frameWidth;
  const frameHeight = input.frameHeight;
  if (!isFiniteNumber(sentAt) || !isFiniteNumber(confidence) || !isFiniteNumber(frameWidth) || !isFiniteNumber(frameHeight)) {
    return { kind: 'invalid' };
  }
  if (now - sentAt > MIRROR_POSE_STALE_MS) return { kind: 'stale' };
  if (input.points.length !== 0 && input.points.length !== MIRROR_LANDMARK_COUNT * 3) return { kind: 'invalid' };
  if (input.points.some((point) => !isFiniteNumber(point))) return { kind: 'invalid' };

  const frame = frameWidth > 0 && frameHeight > 0
    ? { width: frameWidth, height: frameHeight }
    : null;
  const hands = decodeHands(input.hands);
  if (input.points.length === 0) {
    return { kind: 'frame', pose: null, frame, hands };
  }

  const landmarks = [];
  for (let index = 0; index < MIRROR_LANDMARK_COUNT; index += 1) {
    landmarks.push({
      x: input.points[index * 3] as number,
      y: input.points[index * 3 + 1] as number,
      z: 0,
      visibility: clamp01(input.points[index * 3 + 2] as number),
    });
  }
  return {
    kind: 'frame',
    pose: { landmarks, confidence: clamp01(confidence), timestamp: sentAt },
    frame,
    hands,
  };
}

export function encodeMirrorExercise(input: {
  exercise: { name: string; demoVideoUrl?: string | null } | null;
  repCount: number | null;
  targetReps: number | null;
}): MirrorExerciseMessage | null {
  if (!input.exercise || input.repCount == null || input.targetReps == null) return null;
  return {
    name: input.exercise.name,
    demoVideoUrl: input.exercise.demoVideoUrl ?? null,
    repCount: input.repCount,
    targetReps: input.targetReps,
  };
}

export function decodeMirrorExercise(input: unknown): MirrorExerciseMessage | null {
  if (input == null) return null;
  if (!isRecord(input)) return null;
  const { name, demoVideoUrl, repCount, targetReps } = input;
  if (typeof name !== 'string' || name.trim() === '' || name.length > 120) return null;
  if (demoVideoUrl !== null && (typeof demoVideoUrl !== 'string' || demoVideoUrl.length > 500)) return null;
  if (!isWholeNumber(repCount) || !isWholeNumber(targetReps) || targetReps < 1) return null;
  return { name, demoVideoUrl, repCount, targetReps };
}

export function decodeMirrorStatus(input: unknown): string | null {
  if (!isRecord(input)) return null;
  if (input.message == null) return null;
  if (typeof input.message !== 'string' || input.message.length > 240) return null;
  return input.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isWholeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && Number.isInteger(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
