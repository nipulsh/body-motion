import { OneEuroFilter, type OneEuroConfig } from './PostureTemporalTracker';

export interface UpperBackOutlineConfig {
  minFrames: number;
  minDurationMs: number;
  minContourConfidence: number;
  oneEuro: OneEuroConfig;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The body outline's read of the upper back, taken alongside the spine keypoints. The keypoint
 * model pulls a bend toward straight, so a rounded upper back can sit just under its threshold. The
 * outline follows the real edge of the back, but loose clothing can move it, so it is only ever
 * used to back up what the keypoints already lean toward.
 *
 * Its baseline lives here, per monitor, and never touches the stored outline baseline that the
 * outline-only fallback relies on.
 */
export class UpperBackOutline {
  private samples: number[] = [];
  private firstAt = 0;
  private baseline: number | null = null;
  private readonly filter: OneEuroFilter;

  constructor(private readonly config: UpperBackOutlineConfig) {
    this.filter = new OneEuroFilter(config.oneEuro);
  }

  reset(): void {
    this.samples = [];
    this.firstAt = 0;
    this.baseline = null;
    this.filter.reset();
  }

  /** Smoothed rise above the standing outline. Null until a baseline exists or when not read well. */
  update(sagitta: number | null, confidence: number, upright: boolean, timestamp: number): number | null {
    if (sagitta === null || confidence < this.config.minContourConfidence) return null;
    if (this.baseline !== null) return this.filter.filter(sagitta, timestamp) - this.baseline;
    if (!upright) {
      this.samples = [];
      return null;
    }
    if (this.samples.length === 0) this.firstAt = timestamp;
    this.samples.push(sagitta);
    if (this.samples.length >= this.config.minFrames && timestamp - this.firstAt >= this.config.minDurationMs) {
      this.baseline = median(this.samples);
      this.samples = [];
    }
    return null;
  }
}
