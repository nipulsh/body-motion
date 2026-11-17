import { describe, expect, it } from 'vitest';
import type { PoseLandmark, PoseResult } from '../types';
import { POSE_LANDMARK_INDEX } from '../pose/landmarks';
import { mapNormalizedToFitHeight, mapPoseHipToCanvas } from './playerMarker';

function hipsAt(x: number, y: number): PoseResult {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  landmarks[POSE_LANDMARK_INDEX.leftHip] = { x: x + 0.05, y, z: 0, visibility: 0.9 };
  landmarks[POSE_LANDMARK_INDEX.rightHip] = { x: x - 0.05, y, z: 0, visibility: 0.9 };
  return { landmarks, confidence: 0.9, timestamp: 0 };
}

describe('mapNormalizedToFitHeight', () => {
  it('fills the canvas height and centres a narrower picture, leaving the sides empty', () => {
    // 9:16 picture on a 600×800 canvas: 450 px wide, 75 px each side.
    expect(mapNormalizedToFitHeight(0, 0, 600, 800, 1080, 1920)).toEqual({ x: 75, y: 0 });
    expect(mapNormalizedToFitHeight(1, 1, 600, 800, 1080, 1920)).toEqual({ x: 525, y: 800 });
  });

  it('crops the sides of a wider picture instead of shrinking it', () => {
    // 3:4 picture on a 450×800 canvas: 600 px wide, 75 px cut each side.
    expect(mapNormalizedToFitHeight(0, 0.5, 450, 800, 1200, 1600)).toEqual({ x: -75, y: 400 });
    expect(mapNormalizedToFitHeight(0.5, 0.5, 450, 800, 1200, 1600)).toEqual({ x: 225, y: 400 });
  });
});

describe('mapPoseHipToCanvas', () => {
  it('keeps the contain fit by default', () => {
    const p = mapPoseHipToCanvas(hipsAt(0.5, 0.5), 600, 800, 1920, 1080, false)!;
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(400);
  });

  it('can fill the height like the upright game video', () => {
    const p = mapPoseHipToCanvas(hipsAt(0.25, 0.5), 450, 800, 1200, 1600, true, 'height')!;
    // Mirrored: 0.75 of a 600 px picture starting at -75.
    expect(p.x).toBeCloseTo(375);
    expect(p.y).toBeCloseTo(400);
  });
});
