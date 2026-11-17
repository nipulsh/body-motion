import { SIDE_LANDMARKS, type BodySide } from '../exercise/formCommon';
import { distance3D } from '../math/angles';
import { landmarkSeen, POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../types';

export interface LandmarkGateConfig {
  minimumLandmarkVisibility: number;
  worldTorsoLengthM: { min: number; max: number };
  worldThighLengthM: { min: number; max: number };
  worldFallbackConfidence: number;
}

export interface LandmarkGate {
  /** Shoulder, hip, and knee are visible enough to publish a curvature estimate. */
  curvature: boolean;
  /** 0–1. Reduced when world landmarks are present but their scale is implausible. */
  confidence: number;
  /** True only when world landmarks exist and the torso and thigh lengths are plausible. */
  worldLandmarksReliable: boolean;
}

/**
 * Visibility comes from the image landmarks. World landmarks are preferred when their
 * segment lengths look like a body; an implausible scale lowers confidence instead of
 * being treated as the body. This does not change squat or lunge measurement.
 */
export function assessDeadliftLandmarks(pose: PoseResult, side: BodySide, config: LandmarkGateConfig): LandmarkGate {
  const names = SIDE_LANDMARKS[side];
  const required: PoseLandmarkName[] = [names.shoulder, names.hip, names.knee];
  const marks = required.map((name) => pose.landmarks[POSE_LANDMARK_INDEX[name]]);
  const finite = marks.every((mark) => !!mark && Number.isFinite(mark.x) && Number.isFinite(mark.y));
  const minVisibility = Math.min(...marks.map((mark) => mark?.visibility ?? 0));
  const visible =
    finite && marks.every((mark) => landmarkSeen(mark, config.minimumLandmarkVisibility));
  const world = worldScale(pose, names.hip, names.shoulder, names.knee, config);

  let confidence = minVisibility;
  if (world === false) confidence *= config.worldFallbackConfidence;
  if (!visible) confidence = Math.min(confidence, config.minimumLandmarkVisibility * 0.5);
  confidence = Math.max(0, Math.min(1, confidence));

  // An implausible world-landmark scale lowers confidence. It does not mean the
  // shoulder, hip, or knee left the frame.
  return {
    curvature: visible,
    confidence,
    worldLandmarksReliable: world === true,
  };
}

/** True when the scale is plausible, false when it is not, null when world landmarks are absent. */
function worldScale(
  pose: PoseResult,
  hip: PoseLandmarkName,
  shoulder: PoseLandmarkName,
  knee: PoseLandmarkName,
  config: LandmarkGateConfig,
): boolean | null {
  const world = pose.worldLandmarks;
  if (!world || world.length < 33) return null;
  const hipPoint = point(world[POSE_LANDMARK_INDEX[hip]]);
  const shoulderPoint = point(world[POSE_LANDMARK_INDEX[shoulder]]);
  const kneePoint = point(world[POSE_LANDMARK_INDEX[knee]]);
  if (!hipPoint || !shoulderPoint || !kneePoint) return false;
  const torso = distance3D(hipPoint, shoulderPoint);
  const thigh = distance3D(hipPoint, kneePoint);
  const torsoOk = torso >= config.worldTorsoLengthM.min && torso <= config.worldTorsoLengthM.max;
  const thighOk = thigh >= config.worldThighLengthM.min && thigh <= config.worldThighLengthM.max;
  return torsoOk && thighOk;
}

function point(mark: PoseLandmark | undefined): { x: number; y: number; z: number } | null {
  if (!mark || !Number.isFinite(mark.x) || !Number.isFinite(mark.y) || !Number.isFinite(mark.z)) return null;
  return { x: mark.x, y: mark.y, z: mark.z };
}
