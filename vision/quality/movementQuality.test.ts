import { describe, expect, it } from 'vitest';
import { MovementQualityTracker } from './movementQuality';

describe('MovementQuality', () => {
  it('flags rotation that is too fast', () => {
    const tracker = new MovementQualityTracker();
    let quality = tracker.update(0, 0);
    for (let i = 1; i <= 12; i += 1) {
      quality = tracker.update(i * 90, i * 1000);
    }
    expect(quality.tooFast).toBe(true);
    expect(quality.speedDegPerSec).toBeGreaterThan(45);
  });

  it('flags rotation that is too slow', () => {
    const tracker = new MovementQualityTracker();
    tracker.update(0, 0);
    const quality = tracker.update(2, 1000);
    expect(quality.tooSlow).toBe(true);
    expect(quality.tooFast).toBe(false);
    expect(quality.speedDegPerSec).toBeLessThan(8);
  });

  it('treats a moderate turn as neither too fast nor too slow after settling', () => {
    const tracker = new MovementQualityTracker();
    let quality = tracker.update(0, 0);
    for (let i = 1; i <= 12; i += 1) {
      quality = tracker.update(i * 10, i * 500);
    }
    expect(quality.tooFast).toBe(false);
    expect(quality.tooSlow).toBe(false);
    expect(quality.speedDegPerSec).toBeGreaterThan(8);
    expect(quality.speedDegPerSec).toBeLessThan(45);
  });
});
