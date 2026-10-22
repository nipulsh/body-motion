import { VISION_CONFIG } from '../config';
import { nearestSector, normalizeDegrees, shortestAngleDiff } from '../math/angles';

export class CaptureStrategy {
  private readonly filled = new Set<number>();
  private readonly interval = VISION_CONFIG.capture.captureAngleInterval;
  private readonly tolerance = VISION_CONFIG.capture.captureAngleTolerance;
  private readonly maxCount = VISION_CONFIG.capture.maximumImageCount;

  /**
   * `rotationDeg` must be scan-relative continuous rotation (cumulative),
   * not bounded frame yaw. Clockwise and counterclockwise both work via abs().
   */
  shouldCapture(rotationDeg: number, qualityUsable: boolean): number | null {
    if (!qualityUsable) return null;
    if (this.filled.size >= this.maxCount) return null;

    const progressed = Math.abs(rotationDeg);
    const sector = nearestSector(progressed, this.interval);
    if (shortestAngleDiff(normalizeDegrees(progressed), sector) > this.tolerance) return null;
    if (this.filled.has(sector)) return null;
    return sector;
  }

  markCaptured(sector: number): void {
    this.filled.add(normalizeDegrees(sector));
  }

  uniqueCount(): number {
    return this.filled.size;
  }

  hasSector(sector: number): boolean {
    return this.filled.has(normalizeDegrees(sector));
  }

  angularSpan(): number {
    if (this.filled.size === 0) return 0;
    if (this.filled.size >= 36) return 360;

    const sorted = [...this.filled].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      const next = i + 1 < sorted.length ? sorted[i + 1] : (sorted[0] ?? 0) + 360;
      if (current === undefined) continue;
      maxGap = Math.max(maxGap, next - current);
    }
    return 360 - maxGap;
  }

  reset(): void {
    this.filled.clear();
  }
}
