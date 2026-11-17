import { VISION_CONFIG } from '../config';
import type { SpineChainReading } from '../spine/spineChain';
import type { SpineSignalSource } from './NeutralSpineCalibrator';
import { OneEuroFilter, type OneEuroConfig } from './PostureTemporalTracker';

/**
 * Sagittal spine curve. With SpinePose keypoints the stations are the model's estimate of
 * the spine's own line. Without them they come from the visible back: MediaPipe has no
 * vertebra landmarks, so the points are a geometric estimate of the posterior contour
 * between the pelvis and the base of the neck. Neither is a set of detected vertebrae.
 *
 * Curvature is the line's deviation from its own straight chord, as a fraction
 * of torso length. The chord's angle is trunk inclination and is reported separately,
 * so a hip hinge with a straight back is not rounding.
 */

export const SPINE_CURVE_POINT_COUNT = 8;

/** How long a dropped contour may keep its last points on screen. Curvature is not invented during the gap. */
const CURVE_HOLD_MS = 300;

export type SpineEstimateSource = 'measured' | 'estimated' | 'unavailable';

export interface SpineCurvePoint {
  /** Normalized image coordinates. */
  x: number;
  y: number;
  /** 0 at the pelvis, 1 at the neck. */
  t: number;
  confidence: number;
  source: SpineEstimateSource;
}

export interface SpineCurveRegion {
  /**
   * Posterior bulge of this span as a fraction of hip–shoulder length.
   * Positive bows out of the back. Null when the contour was not measured.
   */
  sagitta: number | null;
  confidence: number;
  source: SpineEstimateSource;
}

export interface SpineCurve {
  points: SpineCurvePoint[];
  status: SpineEstimateSource;
  /** What the stations were read from. */
  origin: SpineSignalSource;
  /** Mean confidence of the points. */
  confidence: number;
  /** Share of the back-edge search that found the person. 0 when there is no mask. */
  segmentationConfidence: number;
  upperThoracic: SpineCurveRegion;
  midThoracic: SpineCurveRegion;
  lumbar: SpineCurveRegion;
  overall: SpineCurveRegion;
  /** Hip→shoulder from upright. Not a curvature. */
  trunkInclinationDeg: number | null;
  /** Included shoulder–hip–knee angle. Not a curvature. */
  hipHingeDeg: number | null;
}

export interface SpineCurveInput {
  hip: { x: number; y: number };
  shoulder: { x: number; y: number };
  /** Ear on the same side. Sets how far the neck station sits past the shoulder. */
  ear: { x: number; y: number } | null;
  /**
   * Posterior direction in normalized image coordinates. Length is ignored.
   * Null when the chest side could not be decided.
   */
  outward: { x: number; y: number } | null;
  /** Posterior outline samples. Empty when the mask was not traced. */
  contour: readonly { x: number; y: number }[];
  /** 0–1. */
  segmentationConfidence: number;
  frameAspect?: number;
  trunkInclinationDeg?: number | null;
  hipHingeDeg?: number | null;
}

interface PlanePoint {
  x: number;
  y: number;
  t: number;
  offset: number;
}

const EMPTY_REGION: SpineCurveRegion = { sagitta: null, confidence: 0, source: 'unavailable' };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toPlane(point: { x: number; y: number }, aspect: number): { x: number; y: number } {
  return { x: point.x * aspect, y: point.y };
}

function toImage(point: { x: number; y: number }, aspect: number): { x: number; y: number } {
  return { x: aspect === 0 ? point.x : point.x / aspect, y: point.y };
}

function unavailableCurve(inclination: number | null, hinge: number | null): SpineCurve {
  return {
    points: [],
    status: 'unavailable',
    origin: 'outline',
    confidence: 0,
    segmentationConfidence: 0,
    upperThoracic: EMPTY_REGION,
    midThoracic: EMPTY_REGION,
    lumbar: EMPTY_REGION,
    overall: EMPTY_REGION,
    trunkInclinationDeg: inclination,
    hipHingeDeg: hinge,
  };
}

function region(
  samples: readonly PlanePoint[],
  t0: number,
  t1: number,
  torso: number,
  segmentation: number,
): SpineCurveRegion {
  if (samples.length < 3 || torso <= 1e-6) return EMPTY_REGION;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const span = last.t - first.t;
  const window = samples.filter((sample) => sample.t >= t0 && sample.t <= t1);
  if (window.length < 3 || span < 1e-4) return EMPTY_REGION;
  // Deviation from the whole back's straight chord. A short window of a smooth arc is
  // nearly straight against its own ends, so a local chord would hide a rounded back.
  let peak = 0;
  for (const sample of window) {
    const chord = first.offset + ((sample.t - first.t) / span) * (last.offset - first.offset);
    const deviation = sample.offset - chord;
    if (Math.abs(deviation) > Math.abs(peak)) peak = deviation;
  }
  const confidence = clamp01(segmentation * Math.min(1, window.length / 4));
  return {
    sagitta: peak / torso,
    confidence,
    source: confidence >= 0.35 ? 'measured' : 'estimated',
  };
}

/**
 * Eight stations from the pelvis to the base of the neck. A traced contour places
 * them on the back. Without a contour they follow the hip–shoulder line and carry
 * no curvature number.
 */
export function estimateSpineCurve(input: SpineCurveInput): SpineCurve {
  const aspect = input.frameAspect && input.frameAspect > 0 ? input.frameAspect : 1;
  const inclination = input.trunkInclinationDeg ?? null;
  const hinge = input.hipHingeDeg ?? null;
  if (!Number.isFinite(input.hip.x) || !Number.isFinite(input.shoulder.x)) {
    return unavailableCurve(inclination, hinge);
  }
  const hip = toPlane(input.hip, aspect);
  const shoulder = toPlane(input.shoulder, aspect);
  const axis = { x: shoulder.x - hip.x, y: shoulder.y - hip.y };
  const torso = Math.hypot(axis.x, axis.y);
  if (torso < 1e-4) return unavailableCurve(inclination, hinge);

  let outward = { x: -axis.y / torso, y: axis.x / torso };
  if (input.outward) {
    const given = toPlane(input.outward, aspect);
    const givenLength = Math.hypot(given.x, given.y);
    if (givenLength > 1e-6) outward = { x: given.x / givenLength, y: given.y / givenLength };
  }

  const samples: PlanePoint[] = [];
  for (const point of input.contour) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const plane = toPlane(point, aspect);
    const t = ((plane.x - hip.x) * axis.x + (plane.y - hip.y) * axis.y) / (torso * torso);
    const offset = (plane.x - hip.x) * outward.x + (plane.y - hip.y) * outward.y;
    samples.push({ x: plane.x, y: plane.y, t, offset });
  }
  samples.sort((a, b) => a.t - b.t);

  const segmentation = clamp01(input.segmentationConfidence);
  const measured = samples.length >= 4 && segmentation > 0;
  const offsetAt = (t: number): { offset: number; measured: boolean } => {
    if (samples.length === 0) return { offset: 0, measured: false };
    if (t <= samples[0]!.t) return { offset: samples[0]!.offset, measured: false };
    const last = samples[samples.length - 1]!;
    if (t >= last.t) return { offset: last.offset, measured: false };
    for (let i = 1; i < samples.length; i += 1) {
      const right = samples[i]!;
      if (t > right.t) continue;
      const left = samples[i - 1]!;
      const span = right.t - left.t;
      const mix = span < 1e-6 ? 0 : (t - left.t) / span;
      return { offset: left.offset + (right.offset - left.offset) * mix, measured: true };
    }
    return { offset: last.offset, measured: false };
  };

  const ear = input.ear ? toPlane(input.ear, aspect) : null;
  const neckReach = ear ? Math.min(0.2, Math.hypot(ear.x - shoulder.x, ear.y - shoulder.y) / torso) : 0.08;
  const stations = Array.from({ length: SPINE_CURVE_POINT_COUNT }, (_, index) => {
    const u = index / (SPINE_CURVE_POINT_COUNT - 1);
    return u * (1 + neckReach);
  });

  const points: SpineCurvePoint[] = stations.map((t, index) => {
    const along = { x: hip.x + axis.x * t, y: hip.y + axis.y * t };
    const depth = offsetAt(t);
    const plane = {
      x: along.x + outward.x * depth.offset,
      y: along.y + outward.y * depth.offset,
    };
    const image = toImage(plane, aspect);
    const onContour = measured && depth.measured;
    return {
      x: image.x,
      y: image.y,
      t: index / (SPINE_CURVE_POINT_COUNT - 1),
      confidence: onContour ? segmentation : segmentation * 0.45,
      source: onContour ? 'measured' : 'estimated',
    };
  });

  const confidence = points.reduce((sum, point) => sum + point.confidence, 0) / points.length;
  if (!measured) {
    return {
      points,
      status: 'estimated',
      origin: 'outline',
      confidence,
      segmentationConfidence: segmentation,
      upperThoracic: EMPTY_REGION,
      midThoracic: EMPTY_REGION,
      lumbar: EMPTY_REGION,
      overall: EMPTY_REGION,
      trunkInclinationDeg: inclination,
      hipHingeDeg: hinge,
    };
  }

  return {
    points,
    status: 'measured',
    origin: 'outline',
    confidence,
    segmentationConfidence: segmentation,
    lumbar: region(samples, 0.18, 0.46, torso, segmentation),
    midThoracic: region(samples, 0.4, 0.68, torso, segmentation),
    upperThoracic: region(samples, 0.6, 0.92, torso, segmentation),
    overall: region(samples, 0.18, 0.92, torso, segmentation),
    trunkInclinationDeg: inclination,
    hipHingeDeg: hinge,
  };
}

/**
 * The curve from SpinePose keypoints: the first eight of the chain, hip to the lower neck, drawn
 * where the model put them. Nothing is resampled, so what is on screen is what was detected.
 */
export function spineCurveFromChain(
  chain: SpineChainReading,
  trunkInclinationDeg: number | null,
  hipHingeDeg: number | null,
): SpineCurve {
  const fullScore = VISION_CONFIG.spinePose.chain.fullPointScore;
  const points: SpineCurvePoint[] = chain.points.slice(0, SPINE_CURVE_POINT_COUNT).map((point, index) => ({
    x: point.x,
    y: point.y,
    t: index / (SPINE_CURVE_POINT_COUNT - 1),
    confidence: clamp01(point.score / fullScore),
    source: 'measured',
  }));
  const reading = (sagitta: number): SpineCurveRegion => ({ sagitta, confidence: chain.confidence, source: 'measured' });
  return {
    points,
    status: 'measured',
    origin: 'spinepose',
    confidence: points.reduce((sum, point) => sum + point.confidence, 0) / points.length,
    segmentationConfidence: 0,
    lumbar: reading(chain.lumbar),
    midThoracic: reading(chain.midThoracic),
    upperThoracic: reading(chain.thoracic),
    overall: reading(chain.overall),
    trunkInclinationDeg,
    hipHingeDeg,
  };
}

/**
 * Smooths the eight stations between frames. A contour that disappears for a few
 * frames keeps its last points so the line does not jump, and drops the curvature
 * numbers so a gap cannot open a rounding warning.
 */
export class SpineCurveTracker {
  private readonly filters: OneEuroFilter[] = [];
  private hold: SpineCurve | null = null;
  private holdAt = -Infinity;

  constructor(private readonly config: OneEuroConfig = VISION_CONFIG.deadliftForm.oneEuro) {}

  reset(): void {
    this.filters.length = 0;
    this.hold = null;
    this.holdAt = -Infinity;
  }

  smooth(curve: SpineCurve, timestampMs: number): SpineCurve {
    if (curve.status === 'unavailable' || curve.points.length !== SPINE_CURVE_POINT_COUNT) {
      return this.held(timestampMs) ?? curve;
    }
    if (curve.status === 'measured') {
      this.hold = curve;
      this.holdAt = timestampMs;
    } else if (this.hold && timestampMs - this.holdAt <= CURVE_HOLD_MS && timestampMs >= this.holdAt) {
      const frozen = this.filterPoints(this.hold, timestampMs);
      return { ...frozen, status: 'estimated', upperThoracic: EMPTY_REGION, midThoracic: EMPTY_REGION, lumbar: EMPTY_REGION, overall: EMPTY_REGION };
    }
    return this.filterPoints(curve, timestampMs);
  }

  private held(timestampMs: number): SpineCurve | null {
    if (!this.hold || timestampMs - this.holdAt > CURVE_HOLD_MS || timestampMs < this.holdAt) {
      this.hold = null;
      return null;
    }
    const frozen = this.filterPoints(this.hold, timestampMs);
    return {
      ...frozen,
      status: 'estimated',
      upperThoracic: EMPTY_REGION,
      midThoracic: EMPTY_REGION,
      lumbar: EMPTY_REGION,
      overall: EMPTY_REGION,
    };
  }

  private filterPoints(curve: SpineCurve, timestampMs: number): SpineCurve {
    while (this.filters.length < SPINE_CURVE_POINT_COUNT * 2) this.filters.push(new OneEuroFilter(this.config));
    const points = curve.points.map((point, index) => ({
      ...point,
      x: this.filters[index * 2]!.filter(point.x, timestampMs),
      y: this.filters[index * 2 + 1]!.filter(point.y, timestampMs),
    }));
    return { ...curve, points };
  }
}
