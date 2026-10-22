import { describe, expect, it } from 'vitest';
import { blankLandmarks, poseFromLandmarks, setLandmark } from '../test/fixtures';
import { detectOneLegBalance, detectOneLegBalanceFromLandmarks } from './balanceDetection';

function standingOnLeftLeg(): ReturnType<typeof poseFromLandmarks> {
  const landmarks = blankLandmarks(0.9);
  setLandmark(landmarks, 'leftShoulder', { x: 0.38, y: 0.32, visibility: 0.95 });
  setLandmark(landmarks, 'rightShoulder', { x: 0.62, y: 0.32, visibility: 0.95 });
  setLandmark(landmarks, 'leftHip', { x: 0.42, y: 0.55, visibility: 0.95 });
  setLandmark(landmarks, 'rightHip', { x: 0.58, y: 0.55, visibility: 0.95 });
  setLandmark(landmarks, 'leftKnee', { x: 0.43, y: 0.78, visibility: 0.9 });
  setLandmark(landmarks, 'rightKnee', { x: 0.58, y: 0.64, visibility: 0.9 });
  setLandmark(landmarks, 'leftAnkle', { x: 0.43, y: 0.94, visibility: 0.9 });
  setLandmark(landmarks, 'rightAnkle', { x: 0.6, y: 0.68, visibility: 0.9 });
  setLandmark(landmarks, 'leftFootIndex', { x: 0.43, y: 0.97, visibility: 0.85 });
  setLandmark(landmarks, 'rightFootIndex', { x: 0.58, y: 0.74, visibility: 0.85 });
  return poseFromLandmarks(landmarks);
}

describe('detectOneLegBalance', () => {
  it('detects balance on the left leg', () => {
    const result = detectOneLegBalance(standingOnLeftLeg());
    expect(result.balanced).toBe(true);
    expect(result.supportLeg).toBe('left');
  });

  it('rejects two feet on the ground', () => {
    const landmarks = blankLandmarks(0.9);
    setLandmark(landmarks, 'leftHip', { x: 0.42, y: 0.55, visibility: 0.95 });
    setLandmark(landmarks, 'rightHip', { x: 0.58, y: 0.55, visibility: 0.95 });
    setLandmark(landmarks, 'leftKnee', { x: 0.43, y: 0.78, visibility: 0.9 });
    setLandmark(landmarks, 'rightKnee', { x: 0.57, y: 0.78, visibility: 0.9 });
    setLandmark(landmarks, 'leftAnkle', { x: 0.43, y: 0.94, visibility: 0.9 });
    setLandmark(landmarks, 'rightAnkle', { x: 0.57, y: 0.94, visibility: 0.9 });
    setLandmark(landmarks, 'leftFootIndex', { x: 0.43, y: 0.97, visibility: 0.85 });
    setLandmark(landmarks, 'rightFootIndex', { x: 0.57, y: 0.97, visibility: 0.85 });

    const result = detectOneLegBalanceFromLandmarks(landmarks);
    expect(result.balanced).toBe(false);
  });

  it('returns no_pose when input is null', () => {
    expect(detectOneLegBalance(null).detail).toBe('no_pose');
  });
});
