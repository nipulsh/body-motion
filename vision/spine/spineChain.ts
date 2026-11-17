import type { VISION_CONFIG } from '../config';
import {
  forwardAcrossImage,
  stretchAcrossUp,
  stretchDirection,
  threePointTurnDeg,
  tiltFromUpDeg,
} from '../posture/spinalBiomechanics';
import type { PoseSpine, PoseSpinePoint } from '../types';
import {
  BACK_STATION_COUNT,
  LUMBAR_STATIONS,
  MID_THORACIC_STATIONS,
  OVERALL_STATIONS,
  PELVIS_STATIONS,
  SPINE_CHAIN_LENGTH,
  THORACIC_STATIONS,
  UPPER_BACK_LINE_STATIONS,
} from './spineTrack';

type SpineChainConfig = typeof VISION_CONFIG.spinePose.chain;

const RAD_TO_DEG = 180 / Math.PI;

/** Index into the chain: spine_03 and spine_05. */
const SPINE_03 = 3;
const SPINE_05 = 5;
/** Limits on the upper-back peak, so a stray spine_05 cannot put it at either end of the chain. */
const MIN_UPPER_PEAK = 0.5;
const MAX_UPPER_PEAK = 0.95;
/** Shortest usable top segment, as a fraction of hip → neck. Any shorter and its direction is noise. */
const MIN_TOP_SPAN = 0.08;

export type SpineChainRejection = 'bad_shape' | 'no_direction' | 'low_confidence' | 'folded' | 'implausible' | 'mismatch';

export interface SpineChainContext {
  /** Frame width / height. Normalized x and y span different pixel counts, so shape needs this. */
  aspect: number;
  /** Tracked trunk from the pose landmarks, in the same camera plane: x × aspect, y. */
  hip: { x: number; y: number };
  shoulder: { x: number; y: number };
  /** Unit direction toward the chest in that plane. Null when no landmark could say. */
  chest: { x: number; y: number } | null;
  /** Screen-locked up in the same plane. Needed for the pelvic tilt and for `stretch`. */
  up?: { x: number; y: number };
  /**
   * 1 / cos(body yaw): how far the camera shortened the body's side view across the image. Every
   * point, the tracked trunk included, is stretched back by this before the shape is read. 1 or
   * absent leaves the points as they are.
   */
  stretch?: number;
}

/**
 * Shape of the spine in the camera plane. Each sagitta is the bulge of an arc with that shape over
 * the whole hip → neck length, as a fraction of it. Positive bows out of the back. This is the
 * model's estimate of the spine's line, not a vertebral measurement.
 */
export interface SpineChainReading {
  points: PoseSpinePoint[];
  lumbar: number;
  midThoracic: number;
  thoracic: number;
  overall: number;
  /**
   * How far the spine turns from the low back to the top of the back, in degrees. Positive is
   * rounded, negative is arched.
   */
  bendDeg: number;
  /**
   * Turn at T3 between T8 → T3 and T3 → C7, in degrees. 0 when the three are in a line, positive
   * when T3 bows out of the back. Null when two of them coincide.
   */
  upperBackLineDeg: number | null;
  /** Hip centre → L3 against up, in degrees, positive leaning forward. Null without `up`. */
  pelvicTiltDeg: number | null;
  /** 0–1, from the weakest back station. */
  confidence: number;
}

export type SpineChainResult = { ok: true; reading: SpineChainReading } | { ok: false; reason: SpineChainRejection };

function reject(reason: SpineChainRejection): SpineChainResult {
  return { ok: false, reason };
}

/**
 * Least-squares bulge c in offset = c · 4t(1−t). Every station contributes and the profile is
 * pinned to the chain's two ends, so it reads the same size of arc from any window, however
 * unevenly the stations are spaced. A single peak offset is noisier on real footage.
 */
function fitBulge(t: readonly number[], offset: readonly number[], stations: readonly number[]): number {
  let numerator = 0;
  let denominator = 0;
  for (const i of stations) {
    const basis = 4 * t[i]! * (1 - t[i]!);
    numerator += basis * offset[i]!;
    denominator += basis * basis;
  }
  return denominator > 1e-9 ? numerator / denominator : 0;
}

/**
 * Least-squares bulge of the upper back, where a deadlift bends most: a straight rise from the hip
 * to a peak at spine_05, then straight down to the neck. A smooth whole-back arc reads about its own
 * size on this shape, as it does in `fitBulge`, while a bend up near the shoulders reads about a
 * third larger than it does on a parabola centred mid-back.
 */
function fitUpperBack(t: readonly number[], offset: readonly number[], stations: readonly number[], peakStation: number): number {
  const peak = Math.min(MAX_UPPER_PEAK, Math.max(MIN_UPPER_PEAK, t[peakStation]!));
  let numerator = 0;
  let denominator = 0;
  for (const i of stations) {
    const at = t[i]!;
    const basis = Math.max(0, at <= peak ? at / peak : (1 - at) / (1 - peak));
    numerator += basis * offset[i]!;
    denominator += basis * basis;
  }
  return denominator > 1e-9 ? numerator / denominator : 0;
}

/**
 * Read the spine's curve from the keypoints, or say why it cannot be trusted. Curvature is against
 * the chain's own hip → neck line, so leaning forward does not read as bending, and a result the
 * model returned a moment ago is still valid for shape even though the body has moved since.
 */
export function measureSpineChain(
  spine: PoseSpine,
  context: SpineChainContext,
  config: SpineChainConfig,
): SpineChainResult {
  const points = spine.points;
  if (points.length !== SPINE_CHAIN_LENGTH) return reject('bad_shape');
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.score))) {
    return reject('bad_shape');
  }
  const up = context.up;
  const stretch = up && context.stretch && Number.isFinite(context.stretch) && context.stretch > 0 ? context.stretch : 1;
  // Undo the camera's foreshortening before any shape is read, the tracked trunk included.
  const unshorten = (p: { x: number; y: number }) => (up ? stretchAcrossUp(p, context.hip, up, stretch) : p);
  const plane = points.slice(0, BACK_STATION_COUNT).map((p) => unshorten({ x: p.x * context.aspect, y: p.y }));
  const start = plane[0]!;
  const end = plane[plane.length - 1]!;
  const chordX = end.x - start.x;
  const chordY = end.y - start.y;
  const length = Math.hypot(chordX, chordY);
  if (length < 1e-4) return reject('bad_shape');
  if (!context.chest) return reject('no_direction');
  const chest = up && stretch !== 1 ? stretchDirection(context.chest, up, stretch) : context.chest;

  const minScore = Math.min(...points.slice(0, BACK_STATION_COUNT).map((p) => p.score));
  if (minScore < config.minPointScore) return reject('low_confidence');

  const ux = chordX / length;
  const uy = chordY / length;
  // The sign of out-of-the-back comes from which side the chest is on.
  const towardChest = -uy * chest.x + ux * chest.y;
  const nx = towardChest > 0 ? uy : -uy;
  const ny = towardChest > 0 ? -ux : ux;

  const t: number[] = [];
  const offset: number[] = [];
  for (const p of plane) {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    t.push((dx * ux + dy * uy) / length);
    offset.push((dx * nx + dy * ny) / length);
  }
  for (let i = 1; i < t.length; i += 1) {
    if (t[i]! < t[i - 1]! - config.maxFoldBack) return reject('folded');
  }
  if (offset.some((value) => Math.abs(value) > config.maxOffset)) return reject('implausible');

  const shoulder = unshorten(context.shoulder);
  const trunkX = shoulder.x - context.hip.x;
  const trunkY = shoulder.y - context.hip.y;
  const torso = Math.hypot(trunkX, trunkY);
  if (torso < 1e-4) return reject('mismatch');
  const ratio = length / torso;
  if (ratio < config.minTorsoRatio || ratio > config.maxTorsoRatio) return reject('mismatch');
  if (Math.hypot(start.x - context.hip.x, start.y - context.hip.y) / torso > config.maxHipOffset) return reject('mismatch');
  if ((ux * trunkX + uy * trunkY) / torso < config.minTrunkAlignment) return reject('mismatch');

  // The low back up to spine_03, a long baseline since those stations sit close together, against
  // the last stretch below the neck. spine_05 sits about 80% of the way up, so a chord from spine_03
  // all the way to the neck would average a bend near the shoulders away.
  const neck = plane.length - 1;
  const topStart = t[neck]! - t[SPINE_05]! >= MIN_TOP_SPAN ? SPINE_05 : SPINE_05 - 1;
  const lowerAlong = t[SPINE_03]! - t[0]!;
  const lowerOut = offset[SPINE_03]! - offset[0]!;
  const topAlong = t[neck]! - t[topStart]!;
  const topOut = offset[neck]! - offset[topStart]!;
  const bendDeg = (Math.atan2(lowerOut, lowerAlong) - Math.atan2(topOut, topAlong)) * RAD_TO_DEG;

  const [t8, t3, c7] = UPPER_BACK_LINE_STATIONS.map((i) => plane[i]!);
  const upperBackLineDeg = threePointTurnDeg(t8!, t3!, c7!, chest);
  const [pelvisFrom, pelvisTo] = PELVIS_STATIONS.map((i) => plane[i]!);
  const pelvicTiltDeg = up
    ? tiltFromUpDeg(pelvisFrom!, pelvisTo!, up, forwardAcrossImage(chest, context.hip, shoulder, up))
    : null;

  return {
    ok: true,
    reading: {
      points,
      lumbar: fitBulge(t, offset, LUMBAR_STATIONS),
      midThoracic: fitBulge(t, offset, MID_THORACIC_STATIONS),
      thoracic: fitUpperBack(t, offset, THORACIC_STATIONS, SPINE_05),
      overall: fitBulge(t, offset, OVERALL_STATIONS),
      bendDeg,
      upperBackLineDeg,
      pelvicTiltDeg,
      confidence: Math.min(1, minScore / config.fullPointScore),
    },
  };
}
