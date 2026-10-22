import { describe, expect, it } from 'vitest';
import { CaptureStrategy } from './captureStrategy';

describe('CaptureStrategy', () => {
  it('captures on the 10° grid within tolerance', () => {
    const strategy = new CaptureStrategy();
    expect(strategy.shouldCapture(1, true)).toBe(0);
    strategy.markCaptured(0);
    expect(strategy.shouldCapture(11, true)).toBe(10);
    strategy.markCaptured(10);
    expect(strategy.shouldCapture(14.5, true)).toBeNull();
  });

  it('rejects duplicate sectors', () => {
    const strategy = new CaptureStrategy();
    expect(strategy.shouldCapture(0, true)).toBe(0);
    strategy.markCaptured(0);
    expect(strategy.shouldCapture(2, true)).toBeNull();
    expect(strategy.shouldCapture(358, true)).toBeNull();
  });

  it('does not capture when quality is not usable', () => {
    const strategy = new CaptureStrategy();
    expect(strategy.shouldCapture(0, false)).toBeNull();
  });

  it('stops at the configured maximum even if more angles arrive', () => {
    const strategy = new CaptureStrategy();
    for (let yaw = 0; yaw < 360; yaw += 10) {
      const sector = strategy.shouldCapture(yaw, true);
      if (sector !== null) strategy.markCaptured(sector);
    }
    expect(strategy.uniqueCount()).toBe(36);
    expect(strategy.shouldCapture(0, true)).toBeNull();
    expect(strategy.shouldCapture(5, true)).toBeNull();
    expect(strategy.uniqueCount()).toBeLessThanOrEqual(40);
  });
});
