import { silhouetteAt } from '../pose/silhouette';
import type { PoseSilhouette } from '../types';

export interface ContourPoint {
  x: number;
  y: number;
}

export interface BackContourConfig {
  backSampleFrom: number;
  backSampleTo: number;
  backSampleCount: number;
  /** Torso fraction where the lumbar window ends and the thoracic window begins. */
  backSplit: number;
}

/** A robust fit of one window, still in silhouette pixels. */
export interface ContourWindow {
  /** Posterior bulge of the fitted parabola, in silhouette pixels. Positive bows out of the back. */
  bulgePx: number;
  /** Width of the window as a fraction of the hip–shoulder segment. */
  span: number;
  /** Share of the window's rays that found the back edge. */
  coverage: number;
  /** Typical leftover after the fit, in silhouette pixels. */
  residualPx: number;
}

/**
 * Posterior outline between hip and shoulder. Curvature is estimated from this contour;
 * the mask is not a spine model and does not supply trunk lean.
 */
export interface RawBackContour {
  edge: ContourPoint[];
  /** One hip–shoulder length, straight out of the back, in normalized image coordinates. */
  outward: ContourPoint;
  torsoLengthPx: number;
  /** Full-span bulge, in silhouette pixels, before normalizing. */
  bulgePx: number;
  /** Full-span outline turn, in degrees. Positive bows out of the back. Display only. */
  bendDeg: number;
  thoracic: ContourWindow | null;
  lumbar: ContourWindow | null;
}

/** Silhouette pixels: below this many from hip to shoulder, the outline is too coarse to read. */
const MIN_TORSO_PX = 16;
/** How far out of the trunk line the back edge is searched for, in hip–shoulder lengths. */
const BACK_SEARCH_RATIO = 0.6;
const EDGE_STEP_PX = 0.5;
/** Share of outline samples that must find the back edge. */
const MIN_EDGE_SHARE = 0.7;
const RAD_TO_DEG = 180 / Math.PI;

interface DepthSample {
  /** Position along the full sampled stretch, −1 at its hip end and 1 at its shoulder end. */
  tau: number;
  /** Position along the hip→shoulder segment, 0 at the hip and 1 at the shoulder. */
  t: number;
  /** Distance from the trunk line out to the back edge, in silhouette pixels. */
  depth: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Least-squares depth ≈ a + b·τ + c·τ². */
function fitParabola(samples: readonly DepthSample[]): { a: number; b: number; c: number } | null {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let y0 = 0;
  let y1 = 0;
  let y2 = 0;
  for (const { tau, depth } of samples) {
    const tau2 = tau * tau;
    s0 += 1;
    s1 += tau;
    s2 += tau2;
    s3 += tau2 * tau;
    s4 += tau2 * tau2;
    y0 += depth;
    y1 += depth * tau;
    y2 += depth * tau2;
  }
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-9) return null;
  const detA = y0 * (s2 * s4 - s3 * s3) - s1 * (y1 * s4 - s3 * y2) + s2 * (y1 * s3 - s2 * y2);
  const detB = s0 * (y1 * s4 - s3 * y2) - y0 * (s1 * s4 - s3 * s2) + s2 * (s1 * y2 - y1 * s2);
  const detC = s0 * (s2 * y2 - y1 * s3) - s1 * (s1 * y2 - y1 * s2) + y0 * (s1 * s3 - s2 * s2);
  return { a: detA / det, b: detB / det, c: detC / det };
}

/** Parabola fit that drops stray edge readings (a background object touching the back, say) once. */
function robustParabola(samples: readonly DepthSample[], minSamples: number) {
  const first = fitParabola(samples);
  if (!first) return null;
  const residual = (s: DepthSample) => s.depth - (first.a + first.b * s.tau + first.c * s.tau * s.tau);
  const residuals = samples.map(residual);
  const center = median(residuals);
  const spread = median(residuals.map((r) => Math.abs(r - center)));
  const limit = Math.max(1, 3 * 1.4826 * spread);
  const kept = samples.filter((_, i) => Math.abs(residuals[i]! - center) <= limit);
  if (kept.length === samples.length || kept.length < minSamples) return { fit: first, kept: samples };
  const second = fitParabola(kept);
  return second ? { fit: second, kept } : { fit: first, kept: samples };
}

/** Three-point average along the contour. End samples use the samples they have. */
function smoothDepths(samples: readonly DepthSample[]): DepthSample[] {
  if (samples.length < 3) return samples.map((sample) => ({ ...sample }));
  return samples.map((sample, index) => {
    const prev = samples[index - 1] ?? sample;
    const next = samples[index + 1] ?? sample;
    return { ...sample, depth: (prev.depth + sample.depth + next.depth) / 3 };
  });
}

function withTau(samples: readonly DepthSample[], t0: number, t1: number): DepthSample[] {
  const span = t1 - t0;
  if (span < 1e-6) return [];
  return samples.map((sample) => ({ ...sample, tau: ((sample.t - t0) / span) * 2 - 1 }));
}

/**
 * Local posterior bulge of one window. Outliers are dropped first, then the kept depths are
 * smoothed and refit, so one bad pixel does not become curvature.
 */
function fitWindow(samples: readonly DepthSample[], minSamples: number): { bulgePx: number; span: number; residualPx: number } | null {
  if (samples.length < Math.max(4, minSamples)) return null;
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const keyed = withTau(ordered, ordered[0]!.t, ordered[ordered.length - 1]!.t);
  if (keyed.length < 4) return null;
  const robust = robustParabola(keyed, minSamples);
  if (!robust) return null;
  const kept = [...robust.kept].sort((a, b) => a.t - b.t);
  const smoothed = smoothDepths(withTau(kept, kept[0]!.t, kept[kept.length - 1]!.t));
  const fit = fitParabola(smoothed);
  if (!fit) return null;
  const residuals = smoothed.map((sample) => {
    const predicted = fit.a + fit.b * sample.tau + fit.c * sample.tau * sample.tau;
    return sample.depth - predicted;
  });
  const center = median(residuals);
  const span = kept[kept.length - 1]!.t - kept[0]!.t;
  return {
    bulgePx: -fit.c,
    span,
    residualPx: median(residuals.map((value) => Math.abs(value - center))),
  };
}

/**
 * Read the posterior outline once. From points along the hip→shoulder line, step out of the
 * back until the silhouette ends. Thoracic and lumbar windows share that march.
 */
export function extractBackContour(
  silhouette: PoseSilhouette,
  hip: ContourPoint,
  shoulder: ContourPoint,
  chest: ContourPoint,
  config: BackContourConfig,
): RawBackContour | null {
  const { width, height } = silhouette;
  const hx = hip.x * width;
  const hy = hip.y * height;
  const tx = shoulder.x * width - hx;
  const ty = shoulder.y * height - hy;
  const length = Math.hypot(tx, ty);
  if (length < MIN_TORSO_PX) return null;
  let bx = -ty / length;
  let by = tx / length;
  if (bx * chest.x + by * chest.y > 0) {
    bx = -bx;
    by = -by;
  }

  const count = Math.max(5, config.backSampleCount);
  const from = config.backSampleFrom;
  const to = config.backSampleTo;
  const reach = length * BACK_SEARCH_RATIO;
  const samples: DepthSample[] = [];
  let lumbarExpected = 0;
  let thoracicExpected = 0;
  for (let i = 0; i < count; i += 1) {
    const tau = (2 * i) / (count - 1) - 1;
    const t = from + ((to - from) * (tau + 1)) / 2;
    const lumbar = t <= config.backSplit;
    const px = hx + tx * t;
    const py = hy + ty * t;
    let previous = silhouetteAt(silhouette, px, py);
    if (previous < 0.5) continue;
    if (lumbar) lumbarExpected += 1;
    else thoracicExpected += 1;
    for (let d = EDGE_STEP_PX; d <= reach; d += EDGE_STEP_PX) {
      const value = silhouetteAt(silhouette, px + bx * d, py + by * d);
      if (value < 0.5) {
        const depth = d - EDGE_STEP_PX + (EDGE_STEP_PX * (previous - 0.5)) / (previous - value);
        samples.push({ tau, t, depth });
        break;
      }
      previous = value;
    }
  }

  const minSamples = Math.ceil(count * MIN_EDGE_SHARE);
  if (samples.length < minSamples) return null;
  const robust = robustParabola(samples, minSamples);
  if (!robust) return null;
  // Against the straight line through the fitted ends, a parabola sits −c out at its middle.
  const bulge = -robust.fit.c;
  // The fit spans only the sampled stretch (half-width h of the hip→shoulder line), which shows
  // h² of the bulge a full-length arc would have; scale back to the whole back's sagitta, then
  // to the arc's total turn: θ = 4·atan(2·sagitta / length).
  const half = (to - from) / 2;
  const sagitta = bulge / (4 * half * half);
  const bendDeg = 4 * Math.atan((2 * sagitta) / length) * RAD_TO_DEG;

  const lumbarSamples = samples.filter((sample) => sample.t <= config.backSplit);
  const thoracicSamples = samples.filter((sample) => sample.t > config.backSplit);
  const lumbarMin = Math.max(4, Math.ceil(lumbarExpected * MIN_EDGE_SHARE));
  const thoracicMin = Math.max(4, Math.ceil(thoracicExpected * MIN_EDGE_SHARE));
  const lumbarFit = fitWindow(lumbarSamples, lumbarMin);
  const thoracicFit = fitWindow(thoracicSamples, thoracicMin);

  const window = (
    fit: { bulgePx: number; span: number; residualPx: number } | null,
    expected: number,
    found: number,
  ): ContourWindow | null => {
    if (!fit || expected <= 0) return null;
    return { bulgePx: fit.bulgePx, span: fit.span, residualPx: fit.residualPx, coverage: found / expected };
  };

  return {
    edge: robust.kept.map(({ t, depth }) => ({
      x: (hx + tx * t + bx * depth) / width,
      y: (hy + ty * t + by * depth) / height,
    })),
    outward: { x: (bx * length) / width, y: (by * length) / height },
    torsoLengthPx: length,
    bulgePx: bulge,
    bendDeg,
    thoracic: window(thoracicFit, thoracicExpected, thoracicSamples.length),
    lumbar: window(lumbarFit, lumbarExpected, lumbarSamples.length),
  };
}
