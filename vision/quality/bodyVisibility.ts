import { getLandmark, landmarkSeen } from '../pose/landmarks';
import type { PoseLandmarkName } from '../pose/landmarks';
import { VISION_CONFIG } from '../config';
import type { BodyVisibility, PoseLandmark } from '../types';

const CORE_REQUIRED: readonly PoseLandmarkName[] = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
];

const SIDE_CHAIN: Record<'left' | 'right', readonly PoseLandmarkName[]> = {
  left: ['leftShoulder', 'leftHip', 'leftKnee'],
  right: ['rightShoulder', 'rightHip', 'rightKnee'],
};

function isPresent(lm: PoseLandmark | undefined, minVisibility: number): boolean {
  return landmarkSeen(lm, minVisibility);
}

/**
 * Shoulder width divided by torso length, in aspect-corrected image units.
 * Above the deadlift side-view limit the camera is looking at the front of the body.
 * An unseen side is left out: a profile often has no confident far shoulder, and that
 * point must not be treated as a wide frontal stance.
 */
function profileView(landmarks: readonly PoseLandmark[], frameAspect: number, minVis: number): boolean {
  const limit = VISION_CONFIG.deadliftForm.sideViewRatio;
  const sideOk = (side: 'left' | 'right') =>
    SIDE_CHAIN[side].every((name) => landmarkSeen(getLandmark(landmarks, name), minVis));
  const leftOk = sideOk('left');
  const rightOk = sideOk('right');
  if (leftOk && rightOk) {
    const ls = getLandmark(landmarks, 'leftShoulder')!;
    const rs = getLandmark(landmarks, 'rightShoulder')!;
    const lh = getLandmark(landmarks, 'leftHip')!;
    const rh = getLandmark(landmarks, 'rightHip')!;
    const shoulder = Math.hypot((ls.x - rs.x) * frameAspect, ls.y - rs.y);
    const torso = Math.hypot(
      ((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2) * frameAspect,
      (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2,
    );
    return torso > 0 && shoulder / torso <= limit;
  }
  if (!leftOk && !rightOk) return false;
  const weakSide = leftOk ? 'right' : 'left';
  const strongSide = leftOk ? 'left' : 'right';
  const weak = getLandmark(landmarks, `${weakSide}Shoulder`);
  const strong = getLandmark(landmarks, `${strongSide}Shoulder`);
  const strongHip = getLandmark(landmarks, `${strongSide}Hip`);
  if (
    weak &&
    strong &&
    strongHip &&
    weak.visibility > 0 &&
    Number.isFinite(weak.x) &&
    Number.isFinite(strong.x)
  ) {
    const shoulder = Math.hypot((weak.x - strong.x) * frameAspect, weak.y - strong.y);
    const torso = Math.hypot((strong.x - strongHip.x) * frameAspect, strong.y - strongHip.y);
    if (torso > 0 && shoulder / torso > limit) return false;
  }
  return true;
}

export function evaluateBodyVisibility(
  landmarks: readonly PoseLandmark[],
  frameAspect = 1,
): BodyVisibility {
  const minVis = VISION_CONFIG.quality.minimumVisibilityConfidence;
  const aspect = frameAspect > 0 && Number.isFinite(frameAspect) ? frameAspect : 1;
  if (profileView(landmarks, aspect, minVis)) {
    const side = (['left', 'right'] as const).find((name) =>
      SIDE_CHAIN[name].every((joint) => landmarkSeen(getLandmark(landmarks, joint), minVis)),
    );
    const chain = side ? SIDE_CHAIN[side] : SIDE_CHAIN.left;
    const scored = chain.map((name) => getLandmark(landmarks, name));
    const score = mean(scored);
    return { visible: true, score, missingLandmarks: [] };
  }

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

function mean(marks: Array<PoseLandmark | undefined>): number {
  let sum = 0;
  let count = 0;
  for (const mark of marks) {
    if (!mark) continue;
    sum += mark.visibility;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}
