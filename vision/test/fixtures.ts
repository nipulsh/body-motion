import type { PoseLandmark, PoseResult } from '../types';
import { POSE_LANDMARK_INDEX } from '../pose/landmarks';
import type { PoseLandmarkName } from '../pose/landmarks';

export function blankLandmarks(visibility = 0): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }));
}

export function setLandmark(
  landmarks: PoseLandmark[],
  name: PoseLandmarkName,
  value: Partial<PoseLandmark> & Pick<PoseLandmark, 'x' | 'y'>,
): void {
  const index = POSE_LANDMARK_INDEX[name];
  const current = landmarks[index] ?? { x: 0.5, y: 0.5, z: 0, visibility: 0 };
  const presence = value.presence ?? current.presence;
  landmarks[index] = {
    x: value.x,
    y: value.y,
    z: value.z ?? current.z,
    visibility: value.visibility ?? current.visibility,
    ...(presence !== undefined ? { presence } : {}),
  };
}

export function visibleStandingLandmarks(): PoseLandmark[] {
  const landmarks = blankLandmarks(0.9);
  setLandmark(landmarks, 'nose', { x: 0.5, y: 0.12, z: -0.1, visibility: 0.95 });
  setLandmark(landmarks, 'leftEye', { x: 0.47, y: 0.1, z: -0.1, visibility: 0.9 });
  setLandmark(landmarks, 'rightEye', { x: 0.53, y: 0.1, z: -0.1, visibility: 0.9 });
  setLandmark(landmarks, 'leftShoulder', { x: 0.38, y: 0.32, z: 0, visibility: 0.95 });
  setLandmark(landmarks, 'rightShoulder', { x: 0.62, y: 0.32, z: 0, visibility: 0.95 });
  setLandmark(landmarks, 'leftHip', { x: 0.42, y: 0.58, z: 0, visibility: 0.95 });
  setLandmark(landmarks, 'rightHip', { x: 0.58, y: 0.58, z: 0, visibility: 0.95 });
  setLandmark(landmarks, 'leftElbow', { x: 0.3, y: 0.45, visibility: 0.8 });
  setLandmark(landmarks, 'rightElbow', { x: 0.7, y: 0.45, visibility: 0.8 });
  setLandmark(landmarks, 'leftWrist', { x: 0.28, y: 0.58, visibility: 0.8 });
  setLandmark(landmarks, 'rightWrist', { x: 0.72, y: 0.58, visibility: 0.8 });
  setLandmark(landmarks, 'leftKnee', { x: 0.44, y: 0.78, visibility: 0.85 });
  setLandmark(landmarks, 'rightKnee', { x: 0.56, y: 0.78, visibility: 0.85 });
  setLandmark(landmarks, 'leftAnkle', { x: 0.44, y: 0.95, visibility: 0.85 });
  setLandmark(landmarks, 'rightAnkle', { x: 0.56, y: 0.95, visibility: 0.85 });
  return landmarks;
}

export function poseFromLandmarks(
  landmarks: PoseLandmark[],
  timestamp = 0,
  worldLandmarks?: PoseLandmark[],
): PoseResult {
  const confidence =
    landmarks.reduce((sum, lm) => sum + lm.visibility, 0) / Math.max(landmarks.length, 1);
  return { landmarks, worldLandmarks, confidence, timestamp };
}

/**
 * Camera space used by the estimator: +X image-right, +Y up, +Z toward camera.
 * Person local: +X person's right, +Y up, +Z out the chest.
 * Yaw 0 = facing the camera. Unmirrored webcam: person's left is on the right
 * of the image.
 */
function personToCamera(localX: number, localY: number, localZ: number, yawRad: number): {
  x: number;
  y: number;
  z: number;
} {
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  return {
    x: -localX * cos + localZ * sin,
    y: localY,
    z: localX * sin + localZ * cos,
  };
}

function cameraToImage(cam: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: 0.5 + cam.x,
    y: 0.5 - cam.y,
    z: -cam.z,
  };
}

export function poseForYaw(
  yawDeg: number,
  options?: { faceVisible?: boolean; timestamp?: number; hipsVisible?: boolean },
): PoseResult {
  const rad = (yawDeg * Math.PI) / 180;
  const faceVisible = options?.faceVisible ?? Math.abs(((yawDeg + 180) % 360) - 180) > 60;
  const hipsVisible = options?.hipsVisible ?? true;
  const image = blankLandmarks(0.95);

  const placeLocal = (
    name: PoseLandmarkName,
    localX: number,
    localY: number,
    localZ: number,
    visibility: number,
  ) => {
    const img = cameraToImage(personToCamera(localX, localY, localZ, rad));
    setLandmark(image, name, { ...img, visibility });
  };

  placeLocal('leftShoulder', -0.2, 0.18, 0, 0.95);
  placeLocal('rightShoulder', 0.2, 0.18, 0, 0.95);
  placeLocal('leftHip', -0.15, -0.08, 0, hipsVisible ? 0.95 : 0.05);
  placeLocal('rightHip', 0.15, -0.08, 0, hipsVisible ? 0.95 : 0.05);
  placeLocal('nose', 0, 0.32, 0.12, faceVisible ? 0.95 : 0.05);
  placeLocal('leftEye', -0.03, 0.34, 0.12, faceVisible ? 0.9 : 0.05);
  placeLocal('rightEye', 0.03, 0.34, 0.12, faceVisible ? 0.9 : 0.05);
  placeLocal('leftAnkle', -0.1, -0.4, 0, 0.9);
  placeLocal('rightAnkle', 0.1, -0.4, 0, 0.9);

  return poseFromLandmarks(image, options?.timestamp ?? 0);
}
