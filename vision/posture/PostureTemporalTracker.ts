/** One Euro filter settings. Frequencies are hertz; `beta` is cutoff added per unit of speed. */
export interface OneEuroConfig {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

/**
 * Casiez et al. One Euro filter. A slow signal is smoothed; a fast change raises the cutoff
 * so the filter catches up without waiting on a long moving average.
 */
export class OneEuroFilter {
  private filtered: number | null = null;
  private filteredRate: number | null = null;
  private lastTimeMs: number | null = null;
  private lastRaw: number | null = null;

  constructor(private readonly config: OneEuroConfig) {}

  reset(): void {
    this.filtered = null;
    this.filteredRate = null;
    this.lastTimeMs = null;
    this.lastRaw = null;
  }

  filter(value: number, timestampMs: number): number {
    if (this.lastTimeMs === null || this.lastRaw === null || this.filtered === null) {
      this.lastTimeMs = timestampMs;
      this.lastRaw = value;
      this.filtered = value;
      this.filteredRate = 0;
      return value;
    }
    const dt = (timestampMs - this.lastTimeMs) / 1000;
    if (dt <= 0) return this.filtered;
    const rate = (value - this.lastRaw) / dt;
    this.lastTimeMs = timestampMs;
    this.lastRaw = value;
    this.filteredRate = lowPass(rate, this.filteredRate ?? 0, alpha(dt, this.config.dCutoff));
    const cutoff = this.config.minCutoff + this.config.beta * Math.abs(this.filteredRate);
    this.filtered = lowPass(value, this.filtered, alpha(dt, cutoff));
    return this.filtered;
  }
}

/**
 * Middle of the last few values. Takes out a one-off spike, which a low-pass filter would only
 * spread over the next frames, before the One Euro filter smooths what is left.
 */
export class RecentMedian {
  private values: number[] = [];

  constructor(private readonly size: number) {}

  reset(): void {
    this.values = [];
  }

  add(value: number): number {
    this.values.push(value);
    if (this.values.length > this.size) this.values.shift();
    const sorted = [...this.values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
}

function alpha(dtSec: number, cutoffHz: number): number {
  if (dtSec <= 0 || cutoffHz <= 0) return 1;
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

function lowPass(value: number, previous: number, factor: number): number {
  return factor * value + (1 - factor) * previous;
}

export interface TrackedPoint {
  x: number;
  y: number;
}

export interface PostureSample {
  thoracicSagitta: number | null;
  lumbarSagitta: number | null;
  trunkLeanDeg: number;
  hip: TrackedPoint | null;
  shoulder: TrackedPoint | null;
  knee: TrackedPoint | null;
}

const SAGITTA_GAP_MS = 500;

/**
 * Smooth the deadlift posture signals. A missing sagitta is not filled in from the previous
 * frame: that frame stays unpublished. The filter keeps its state so the next good frame
 * does not start over, unless the gap is long enough that the old posture is stale.
 */
export class PostureTemporalTracker {
  private readonly thoracic: OneEuroFilter;
  private readonly lumbar: OneEuroFilter;
  private readonly lean: OneEuroFilter;
  private readonly hipX: OneEuroFilter;
  private readonly hipY: OneEuroFilter;
  private readonly shoulderX: OneEuroFilter;
  private readonly shoulderY: OneEuroFilter;
  private readonly kneeX: OneEuroFilter;
  private readonly kneeY: OneEuroFilter;
  private lastSagittaMs: number | null = null;

  constructor(config: OneEuroConfig) {
    this.thoracic = new OneEuroFilter(config);
    this.lumbar = new OneEuroFilter(config);
    this.lean = new OneEuroFilter(config);
    this.hipX = new OneEuroFilter(config);
    this.hipY = new OneEuroFilter(config);
    this.shoulderX = new OneEuroFilter(config);
    this.shoulderY = new OneEuroFilter(config);
    this.kneeX = new OneEuroFilter(config);
    this.kneeY = new OneEuroFilter(config);
  }

  reset(): void {
    this.thoracic.reset();
    this.lumbar.reset();
    this.lean.reset();
    this.hipX.reset();
    this.hipY.reset();
    this.shoulderX.reset();
    this.shoulderY.reset();
    this.kneeX.reset();
    this.kneeY.reset();
    this.lastSagittaMs = null;
  }

  smooth(sample: PostureSample, timestampMs: number): PostureSample {
    if (this.lastSagittaMs !== null && timestampMs - this.lastSagittaMs > SAGITTA_GAP_MS) {
      this.thoracic.reset();
      this.lumbar.reset();
    }
    const thoracicSagitta = this.smoothOptional(this.thoracic, sample.thoracicSagitta, timestampMs);
    const lumbarSagitta = this.smoothOptional(this.lumbar, sample.lumbarSagitta, timestampMs);
    if (sample.thoracicSagitta !== null || sample.lumbarSagitta !== null) this.lastSagittaMs = timestampMs;
    return {
      thoracicSagitta,
      lumbarSagitta,
      trunkLeanDeg: this.lean.filter(sample.trunkLeanDeg, timestampMs),
      hip: this.smoothPoint(this.hipX, this.hipY, sample.hip, timestampMs),
      shoulder: this.smoothPoint(this.shoulderX, this.shoulderY, sample.shoulder, timestampMs),
      knee: this.smoothPoint(this.kneeX, this.kneeY, sample.knee, timestampMs),
    };
  }

  private smoothOptional(filter: OneEuroFilter, value: number | null, timestampMs: number): number | null {
    if (value === null) return null;
    return filter.filter(value, timestampMs);
  }

  private smoothPoint(
    xFilter: OneEuroFilter,
    yFilter: OneEuroFilter,
    point: TrackedPoint | null,
    timestampMs: number,
  ): TrackedPoint | null {
    if (!point) return null;
    return { x: xFilter.filter(point.x, timestampMs), y: yFilter.filter(point.y, timestampMs) };
  }
}
