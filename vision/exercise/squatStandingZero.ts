import type { VISION_CONFIG } from '../config';
import { round1, type BodySide, type Tilt } from './formCommon';
import type { SquatFormFrame, SquatView } from './squatForm';

type ZeroConfig = Pick<
  typeof VISION_CONFIG.squatForm,
  | 'zeroHoldMs'
  | 'zeroStillnessDeg'
  | 'zeroMaxGapMs'
  | 'zeroMaxKneeFlexionDeg'
  | 'zeroMaxLeanDeg'
  | 'zeroMinHipRise'
  | 'zeroHipDropRatio'
  | 'zeroStraighterMarginDeg'
  | 'zeroDeadbandDeg'
>;

/** Signed readings by name, e.g. `left.knee`, `right.kneeHeel`, `shoulderTilt`. `*.rise` is a ratio, not degrees. */
type Readings = Record<string, number>;

const SIDES: readonly BodySide[] = ['left', 'right'];
const TILTS = ['eyeTilt', 'shoulderTilt', 'pelvisTilt', 'trunkSideLean'] as const;

/** Fewest frames that can make a hold, however slow the camera. */
const MIN_HOLD_FRAMES = 5;
/** A reading seen in under this share of a hold (a flickering landmark) is not zeroed from it. */
const MIN_READING_SHARE = 0.25;
/** Share of a hold's frames that must be close to the middle reading, so one bad frame does not break it. */
const STILL_SHARE = 0.9;
/** A glitch this many frames long does not end a hold. Stepping out of the pose takes longer. */
const MAX_MISSED_FRAMES = 2;

const tiltToSigned = (tilt: Tilt): number => (tilt.toward === 'left' ? tilt.deg : -tilt.deg);

/** Smallest signed turn from `base` to `value`, in (−180, 180]. */
function turnFrom(base: number, value: number): number {
  let turn = value - base;
  while (turn > 180) turn -= 360;
  while (turn <= -180) turn += 360;
  return turn;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function readingsOf(frame: SquatFormFrame): Readings {
  const readings: Readings = {};
  for (const side of SIDES) {
    const flexion = frame.kneeFlexion[side];
    const knee = frame.kneeLean[side];
    const back = frame.backLean[side];
    const kneeHeel = frame.kneeHeelLean[side];
    const rise = frame.hipRise[side];
    if (flexion !== undefined) readings[`${side}.flexion`] = flexion;
    if (rise !== undefined) readings[`${side}.rise`] = rise;
    if (knee !== undefined) readings[`${side}.knee`] = knee;
    if (back !== undefined) readings[`${side}.back`] = back;
    if (kneeHeel !== undefined) readings[`${side}.kneeHeel`] = kneeHeel;
  }
  for (const name of TILTS) {
    const tilt = frame[name];
    if (tilt) readings[name] = tiltToSigned(tilt);
  }
  return readings;
}

/**
 * Face on, the knee readings rest on metric depth, MediaPipe's noisiest axis. Their jitter says
 * nothing about whether the patient moved, so they never stop the zero of everything else.
 */
function isDepthReading(view: SquatView, name: string): boolean {
  return view === 'front' && (name.endsWith('.flexion') || name.endsWith('.knee'));
}

/** Hip height is a share of shin length, not an angle: degree tolerances do not apply to it. */
function isRatioReading(name: string): boolean {
  return name.endsWith('.rise');
}

/** The zero's reading for `name` on `side`; side on, the other leg's stands in (one line in the image). */
function zeroReading(zero: Readings, view: SquatView, side: BodySide, name: string): number | undefined {
  const other: BodySide = side === 'left' ? 'right' : 'left';
  return zero[`${side}.${name}`] ?? (view === 'side' ? zero[`${other}.${name}`] : undefined);
}

function looksLikeStanding(frame: SquatFormFrame, config: ZeroConfig): boolean {
  const knees = SIDES.map((side) => frame.kneeFlexion[side]).filter((angle) => angle !== undefined);
  if (knees.length === 0 || knees.some((angle) => angle > config.zeroMaxKneeFlexionDeg)) return false;
  // Face on, flexion rests on depth and can read a real squat as nearly straight. The hips
  // coming down to the knees cannot.
  if (SIDES.some((side) => (frame.hipRise[side] ?? Infinity) < config.zeroMinHipRise)) return false;
  const tilted = TILTS.some((name) => (frame[name]?.deg ?? 0) > config.zeroMaxLeanDeg);
  if (tilted) return false;
  return SIDES.every((side) => {
    const leans = [frame.backLean[side], frame.kneeHeelLean[side]];
    return leans.every((lean) => lean === undefined || Math.abs(lean) <= config.zeroMaxLeanDeg);
  });
}

/**
 * Each patient's own standing pose is what reads 0°. Bodies are not straight lines: the heel sits
 * behind the knee, a relaxed knee stays slightly bent, shoulders rarely sit perfectly level, and
 * the camera may be rolled a few degrees. So the pose held still while standing is recorded and
 * subtracted from the angles shown.
 *
 * Only the displayed numbers change, plus the side-view back line, which is drawn along the
 * standing back so it agrees with the 0° shown. Faults and the other reference lines stay on true
 * geometry.
 *
 * Zeros are kept per camera view, since each view sees different angles. Holding still again
 * refreshes the zero, so a pose caught while the patient was still settling does not stay. The
 * left–right lines (eyes, shoulders, hips, trunk) refresh on every hold. The rest refresh only from
 * a hold at least about as straight as the straightest seen, so a held partial squat cannot become
 * the new standing. Every hold, the first one included, needs the hips well above the knees, and
 * once a zero is set, about as high as in it: a squat held still never counts as standing.
 */
export class SquatStandingZero {
  private readonly zeros = new Map<SquatView, Readings>();
  private hold: Array<{ t: number; readings: Readings }> = [];
  private holdView: SquatView | null = null;
  private missedFrames = 0;
  private up: { x: number; y: number } | null = null;

  constructor(private readonly config: ZeroConfig) {}

  reset(): void {
    this.zeros.clear();
    this.hold = [];
    this.holdView = null;
    this.missedFrames = 0;
    this.up = null;
  }

  /** Record `frame` toward the zero and return it measured from the zero, when there is one. */
  apply(frame: SquatFormFrame, timestamp: number): SquatFormFrame {
    // Angles are signed against the reference axis, so a zero cannot outlive a turn of that axis.
    if (this.up && (this.up.x !== frame.upImage.x || this.up.y !== frame.upImage.y)) this.reset();
    this.up = frame.upImage;
    this.observe(frame, timestamp);
    const zero = this.zeros.get(frame.view);
    return zero ? this.measureFrom(frame, zero) : frame;
  }

  private observe(frame: SquatFormFrame, t: number): void {
    const previous = this.hold[this.hold.length - 1];
    const broken =
      frame.view !== this.holdView ||
      (previous !== undefined && (t < previous.t || t - previous.t > this.config.zeroMaxGapMs));
    if (broken) {
      this.hold = [];
      this.holdView = frame.view;
      this.missedFrames = 0;
    }
    if (!looksLikeStanding(frame, this.config) || this.belowStandingHips(frame)) {
      this.missedFrames += 1;
      if (this.missedFrames > MAX_MISSED_FRAMES) this.hold = [];
      return;
    }
    this.missedFrames = 0;

    const { zeroHoldMs } = this.config;
    this.hold.push({ t, readings: readingsOf(frame) });
    while (this.hold.length > 1 && t - this.hold[1]!.t >= zeroHoldMs) this.hold.shift();
    if (t - this.hold[0]!.t < zeroHoldMs || this.hold.length < MIN_HOLD_FRAMES) return;

    const still = this.stillReadings(frame.view);
    if (!still) return;
    this.commit(frame.view, still);
    this.hold = [];
  }

  /**
   * Hips clearly lower than in this view's zero: a held squat, however still, is not standing.
   * Without this a held squat would become the new zero and every angle would drop to 0°.
   */
  private belowStandingHips(frame: SquatFormFrame): boolean {
    const zero = this.zeros.get(frame.view);
    if (!zero) return false;
    return SIDES.some((side) => {
      const rise = frame.hipRise[side];
      const standing = zeroReading(zero, frame.view, side, 'rise');
      return rise !== undefined && standing !== undefined && rise < standing - this.config.zeroHipDropRatio;
    });
  }

  /** The middle value of each reading across the hold, or null if the patient moved. */
  private stillReadings(view: SquatView): Readings | null {
    const names = new Set(this.hold.flatMap((sample) => Object.keys(sample.readings)));
    const still: Readings = {};
    for (const name of names) {
      const values = this.hold
        .map((sample) => sample.readings[name])
        .filter((value) => value !== undefined);
      if (values.length < this.hold.length * MIN_READING_SHARE) continue;
      const middle = median(values);
      const close = values.filter((value) => Math.abs(turnFrom(middle, value)) <= this.config.zeroStillnessDeg);
      const exempt = isDepthReading(view, name) || isRatioReading(name);
      if (close.length < values.length * STILL_SHARE && !exempt) return null;
      still[name] = middle;
    }
    return still;
  }

  private commit(view: SquatView, still: Readings): void {
    const zero = this.zeros.get(view);
    if (!zero) {
      this.zeros.set(view, still);
      return;
    }
    const asStraight = SIDES.every((side) => {
      const flexion = `${side}.flexion`;
      return (
        still[flexion] === undefined ||
        zero[flexion] === undefined ||
        still[flexion] <= zero[flexion] + this.config.zeroStraighterMarginDeg
      );
    });
    // Otherwise only fill in what was hidden.
    const next: Readings = asStraight ? { ...zero, ...still } : { ...still, ...zero };
    for (const name of TILTS) {
      if (still[name] !== undefined) next[name] = still[name];
    }
    // The bar stays at the straightest pose seen, so repeated holds cannot creep it toward a bend.
    for (const side of SIDES) {
      const flexion = `${side}.flexion`;
      const held = still[flexion];
      const kept = zero[flexion];
      if (held !== undefined && kept !== undefined) next[flexion] = Math.min(held, kept);
      // Likewise the hips: the tallest standing seen is the one a held squat is measured against.
      const rise = `${side}.rise`;
      const heldRise = still[rise];
      const keptRise = zero[rise];
      if (heldRise !== undefined && keptRise !== undefined) next[rise] = Math.max(heldRise, keptRise);
    }
    this.zeros.set(view, next);
  }

  private measureFrom(frame: SquatFormFrame, zero: Readings): SquatFormFrame {
    const quiet = (deg: number) => (Math.abs(deg) <= this.config.zeroDeadbandDeg ? 0 : round1(deg));
    const sideOn = frame.view === 'side';

    const kneeAngle: SquatFormFrame['kneeAngle'] = {};
    const backAngle: SquatFormFrame['backAngle'] = {};
    const kneeHeelAngle: SquatFormFrame['kneeHeelAngle'] = {};
    const backReference: SquatFormFrame['backReference'] = {};
    for (const side of SIDES) {
      // Side on, the two legs are one line in the image. The near leg can swap between frames, and
      // a leg with no zero of its own must not fall back to raw geometry.
      const zeroOf = (name: string) => zeroReading(zero, frame.view, side, name) ?? 0;
      const knee = frame.kneeLean[side];
      const back = frame.backLean[side];
      const kneeHeel = frame.kneeHeelLean[side];
      if (knee !== undefined) {
        // Face on it is unsigned: a knee straighter than the standing pose is not a bend.
        kneeAngle[side] = quiet(
          sideOn ? Math.abs(turnFrom(zeroOf('knee'), knee)) : Math.max(0, knee - zeroOf('knee')),
        );
      }
      if (back !== undefined) {
        backAngle[side] = quiet(Math.abs(turnFrom(zeroOf('back'), back)));
        // The 0° back line is the patient's own standing back, the slight lean they stand with.
        backReference[side] = round1(zeroOf('back'));
      }
      if (kneeHeel !== undefined) kneeHeelAngle[side] = quiet(Math.abs(turnFrom(zeroOf('kneeHeel'), kneeHeel)));
    }

    const measured: SquatFormFrame = { ...frame, zeroSet: true, kneeAngle, backAngle, kneeHeelAngle, backReference };
    for (const name of TILTS) {
      const tilt = frame[name];
      if (!tilt) continue;
      const turn = turnFrom(zero[name] ?? 0, tiltToSigned(tilt));
      measured[name] = { deg: quiet(Math.abs(turn)), toward: turn > 0 ? 'left' : 'right' };
    }
    return measured;
  }
}
