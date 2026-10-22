import { describe, expect, it } from 'vitest';
import { evaluateBodyVisibility } from './bodyVisibility';
import { blankLandmarks, setLandmark, visibleStandingLandmarks } from '../test/fixtures';

describe('BodyVisibility', () => {
  it('accepts the minimum subset of shoulders, hips, and nose', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.4, y: 0.3, visibility: 0.9 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.6, y: 0.3, visibility: 0.9 });
    setLandmark(landmarks, 'leftHip', { x: 0.42, y: 0.6, visibility: 0.9 });
    setLandmark(landmarks, 'rightHip', { x: 0.58, y: 0.6, visibility: 0.9 });
    setLandmark(landmarks, 'nose', { x: 0.5, y: 0.1, visibility: 0.9 });
    const result = evaluateBodyVisibility(landmarks);
    expect(result.visible).toBe(true);
    expect(result.missingLandmarks).toEqual([]);
  });

  it('accepts ankles instead of a visible nose', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.4, y: 0.3, visibility: 0.9 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.6, y: 0.3, visibility: 0.9 });
    setLandmark(landmarks, 'leftHip', { x: 0.42, y: 0.6, visibility: 0.9 });
    setLandmark(landmarks, 'rightHip', { x: 0.58, y: 0.6, visibility: 0.9 });
    setLandmark(landmarks, 'leftAnkle', { x: 0.44, y: 0.95, visibility: 0.9 });
    setLandmark(landmarks, 'rightAnkle', { x: 0.56, y: 0.95, visibility: 0.9 });
    const result = evaluateBodyVisibility(landmarks);
    expect(result.visible).toBe(true);
  });

  it('reports missing joints when the subset is incomplete', () => {
    const landmarks = visibleStandingLandmarks();
    setLandmark(landmarks, 'leftShoulder', { x: 0.4, y: 0.3, visibility: 0.1 });
    setLandmark(landmarks, 'rightHip', { x: 0.58, y: 0.6, visibility: 0.1 });
    const result = evaluateBodyVisibility(landmarks);
    expect(result.visible).toBe(false);
    expect(result.missingLandmarks).toContain('leftShoulder');
    expect(result.missingLandmarks).toContain('rightHip');
  });
});
