/** SpinePose keypoints that line up with the `hinge()` body, for the deadlift and overlay tests. */
import { SPINE_CHAIN_LENGTH } from '../spine/spineTrack';
import type { PoseSpine } from '../types';
import { H, W } from './deadliftHinge';

/** Where the model puts its stations along hip → neck on real footage, then the two neck points. */
export const STATION_T = [0, 0.05, 0.15, 0.3, 0.47, 0.78, 1, 1.09, 1.18] as const;

const TORSO_PX = 110;

export interface ChainOptions {
  facing?: 'right' | 'left';
  leanDeg?: number;
  /** Whole-back bulge out of the back, as a fraction of hip → neck. Negative hollows it. */
  bulge?: number;
  /** Bulge of the lumbar stations only. Ends before spine_03. */
  lumbarBulge?: number;
  /** Bulge of the thoracic stations only. Starts after spine_03. */
  thoracicBulge?: number;
  score?: number;
  capturedAt?: number;
  /** Pixels added to the hip's image y, to match `hinge({ hipShiftY })`. */
  hipShiftY?: number;
  /** Multiplies the chain length, to make it disagree with the MediaPipe torso. */
  lengthScale?: number;
}

function hump(t: number, center: number, radius: number): number {
  const u = (t - center) / radius;
  return Math.abs(u) >= 1 ? 0 : 1 - u * u;
}

export function chainFor(options: ChainOptions = {}): PoseSpine {
  const { facing = 'right', leanDeg = 50, bulge = 0, lumbarBulge = 0, thoracicBulge = 0, score = 1, capturedAt = 0 } = options;
  const dir = facing === 'right' ? 1 : -1;
  const lean = (leanDeg * Math.PI) / 180;
  const u = { x: dir * Math.sin(lean), y: -Math.cos(lean) };
  const chest = { x: dir * Math.cos(lean), y: Math.sin(lean) };
  const hip = { x: 320, y: 230 + (options.hipShiftY ?? 0) };
  const length = TORSO_PX * (options.lengthScale ?? 1);
  const points = STATION_T.slice(0, SPINE_CHAIN_LENGTH).map((t) => {
    const inner = Math.min(t, 1);
    const out =
      bulge * 4 * inner * (1 - inner) + lumbarBulge * hump(inner, 0.15, 0.15) + thoracicBulge * hump(inner, 0.62, 0.32);
    return {
      x: (hip.x + u.x * length * t - chest.x * length * out) / W,
      y: (hip.y + u.y * length * t - chest.y * length * out) / H,
      score,
    };
  });
  return { points, capturedAt };
}

/** One SimCC axis with a single peak at `bin`. */
export function simccAxis(bin: number, bins: number, peak: number): Float32Array {
  const axis = new Float32Array(bins).fill(0.01);
  const at = Math.max(0, Math.min(bins - 1, Math.round(bin)));
  axis[at] = peak;
  return axis;
}
