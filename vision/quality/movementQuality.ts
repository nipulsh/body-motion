import { VISION_CONFIG } from '../config';
import { unwrapDelta } from '../math/angles';
import type { MovementQuality } from '../types';

export class MovementQualityTracker {
  private lastYawDeg: number | null = null;
  private lastTimestamp: number | null = null;
  private emaSpeed = 0;

  update(yawDeg: number, timestampMs: number): MovementQuality {
    if (this.lastYawDeg === null || this.lastTimestamp === null) {
      this.lastYawDeg = yawDeg;
      this.lastTimestamp = timestampMs;
      return { speedDegPerSec: 0, tooFast: false, tooSlow: true };
    }

    const dtSec = (timestampMs - this.lastTimestamp) / 1000;
    const delta = unwrapDelta(this.lastYawDeg, yawDeg);
    this.lastYawDeg = yawDeg;
    this.lastTimestamp = timestampMs;

    if (dtSec <= 0) {
      return this.snapshot();
    }

    const instant = Math.abs(delta) / dtSec;
    const alpha = 1 / VISION_CONFIG.motion.smoothingWindowSize;
    this.emaSpeed = this.emaSpeed + (instant - this.emaSpeed) * alpha;
    return this.snapshot();
  }

  reset(): void {
    this.lastYawDeg = null;
    this.lastTimestamp = null;
    this.emaSpeed = 0;
  }

  private snapshot(): MovementQuality {
    const speedDegPerSec = this.emaSpeed;
    return {
      speedDegPerSec,
      tooFast: speedDegPerSec > VISION_CONFIG.motion.maximumRotationSpeed,
      tooSlow: speedDegPerSec < VISION_CONFIG.motion.minimumRotationSpeed,
    };
  }
}
