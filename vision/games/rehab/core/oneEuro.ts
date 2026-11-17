/** One-Euro filter (Casiez et al. 2012) for one scalar signal. Time in seconds. */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff: number,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, t: number): number {
    if (this.x === null || !Number.isFinite(this.x)) {
      this.x = value;
      this.dx = 0;
      this.lastT = t;
      return value;
    }
    const dt = t - this.lastT;
    if (dt <= 0) return this.x;
    this.lastT = t;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuroFilter.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuroFilter.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** One-Euro filter on every coordinate of a fixed-length point list. */
export class PointsFilter {
  private filters: OneEuroFilter[] = [];

  constructor(
    private readonly dims: number,
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff: number,
  ) {}

  reset(): void {
    for (const f of this.filters) f.reset();
  }

  filter(values: readonly number[], t: number): number[] {
    while (this.filters.length < values.length) {
      this.filters.push(new OneEuroFilter(this.minCutoff, this.beta, this.dCutoff));
    }
    return values.map((v, i) => this.filters[i].filter(v, t));
  }

  get dimensions(): number {
    return this.dims;
  }
}
