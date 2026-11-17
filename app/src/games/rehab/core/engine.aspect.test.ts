import { describe, expect, it } from 'vitest';
import type { PoseResult } from '@vision';
import { RehabEngine } from './engine';
import { DEFAULT_SETTINGS } from './settings';

function pose(frameAspect: number): PoseResult {
  return {
    landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 })),
    confidence: 1,
    timestamp: 0,
    frameAspect,
  };
}

describe('rehab display aspect', () => {
  it('copies the live frame aspect onto the mapper, including a vertical image', () => {
    const portrait = new RehabEngine(DEFAULT_SETTINGS);
    expect(portrait.display.aspect).toBe(16 / 9);
    portrait.onPose(pose(9 / 16));
    expect(portrait.display.aspect).toBeCloseTo(9 / 16);

    const landscape = new RehabEngine(DEFAULT_SETTINGS);
    landscape.onPose(pose(16 / 9));
    expect(landscape.display.aspect).toBeCloseTo(16 / 9);
  });

  it('keeps the last aspect when the picture drops out', () => {
    const engine = new RehabEngine(DEFAULT_SETTINGS);
    engine.onPose(pose(9 / 16));
    engine.onPose(null);
    expect(engine.display.aspect).toBeCloseTo(9 / 16);
  });
});
