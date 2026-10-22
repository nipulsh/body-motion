import { getLandmark } from '../pose/landmarks';
import type { PoseLandmarkName } from '../pose/landmarks';
import { VISION_CONFIG } from '../config';
import type { BodyVisibility, PoseLandmark } from '../types';

const CORE_REQUIRED: readonly PoseLandmarkName[] = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
];

function isPresent(lm: PoseLandmark | undefined, minVisibility: number): boolean {
  return Boolean(lm && lm.visibility >= minVisibility);
}

export function evaluateBodyVisibility(landmarks: readonly PoseLandmark[]): BodyVisibility {
  const minVis = VISION_CONFIG.quality.minimumVisibilityConfidence;
  const missingLandmarks: string[] = [];

  for (const name of CORE_REQUIRED) {
    if (!isPresent(getLandmark(landmarks, name), minVis)) {
      missingLandmarks.push(name);
    }
  }

  const noseOk = isPresent(getLandmark(landmarks, 'nose'), minVis);
  const anklesOk =
    isPresent(getLandmark(landmarks, 'leftAnkle'), minVis) &&
    isPresent(getLandmark(landmarks, 'rightAnkle'), minVis);

  if (!noseOk && !anklesOk) {
    if (!noseOk) missingLandmarks.push('nose');
    if (!isPresent(getLandmark(landmarks, 'leftAnkle'), minVis)) missingLandmarks.push('leftAnkle');
    if (!isPresent(getLandmark(landmarks, 'rightAnkle'), minVis)) missingLandmarks.push('rightAnkle');
  }

  const scored = [
    getLandmark(landmarks, 'leftShoulder'),
    getLandmark(landmarks, 'rightShoulder'),
    getLandmark(landmarks, 'leftHip'),
    getLandmark(landmarks, 'rightHip'),
    getLandmark(landmarks, 'nose'),
  ];
  let sum = 0;
  let count = 0;
  for (const lm of scored) {
    if (!lm) continue;
    sum += lm.visibility;
    count += 1;
  }
  const score = count > 0 ? sum / count : 0;
  const visible = missingLandmarks.length === 0 && score >= minVis;

  return { visible, score, missingLandmarks };
}
