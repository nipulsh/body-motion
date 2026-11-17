import type { PoseLandmark } from '../types';

export const POSE_LANDMARK_INDEX = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export type PoseLandmarkName = keyof typeof POSE_LANDMARK_INDEX;

export const POSE_LANDMARK_NAMES = Object.keys(POSE_LANDMARK_INDEX) as PoseLandmarkName[];

export function getLandmark(
  landmarks: readonly PoseLandmark[],
  name: PoseLandmarkName,
): PoseLandmark | undefined {
  return landmarks[POSE_LANDMARK_INDEX[name]];
}

/**
 * Seen in the camera. Visibility is the occlusion score. Presence can keep a partly
 * hidden point (a side-view hip the model is still tracking) without treating a
 * point that has almost no visibility as on screen.
 */
export function landmarkSeen(landmark: PoseLandmark | undefined, minVisibility: number): boolean {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return false;
  if (landmark.visibility >= minVisibility) return true;
  const presence = landmark.presence ?? 0;
  return presence >= minVisibility && landmark.visibility >= minVisibility * 0.6;
}
