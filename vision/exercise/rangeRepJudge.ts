import { VISION_CONFIG } from '../config';
import {
  judgeInRange,
  tibiaBandFor,
  TIBIA_TOLERANCE_DEG,
  worstVerdict,
  compareVerdicts,
  type DegreeRange,
  type RangeModel,
  type RangeVerdict,
  type RangeView,
} from './angleRangeModels';
import { round1, type BodySide } from './formCommon';

type RangeJudgeConfig = typeof VISION_CONFIG.rangeJudge;

export type RangeAngle = 'knee' | 'back' | 'ankle' | 'tibia';

/** One frame's readings, already measured from the patient's standing pose where that applies. */
export interface RangeSample {
  view: RangeView;
  /** Side view: thigh from vertical (squat: the near leg; lunge: the front leg). Also the rep's depth. */
  knee?: number;
  /** Side view: trunk from vertical. */
  back?: number;
  /** Side view, lunge: front shin from vertical. */
  ankle?: number;
  /** Front view: hip height over the knees as a share of shin length; it finds the rep. */
  hipRise?: number;
  /** Front view: tibia per leg, signed, positive with the knee outside the heel line. */
  tibia?: Partial<Record<BodySide, number>>;
  /** Front view: estimated toe-out per leg. */
  toeOut?: Partial<Record<BodySide, number>>;
}

export interface RangeCheck {
  angle: RangeAngle;
  /** The leg, for tibia. */
  side?: BodySide;
  /** The judged reading, in degrees. */
  value: number;
  range: DegreeRange;
  toleranceDeg: number;
  verdict: RangeVerdict;
  off: 'low' | 'high' | null;
  offByDeg: number;
  /** Tibia: the toe-out its range was picked by. */
  toeOutDeg?: number;
}

export interface RangeRep {
  /** 1-based attempt in this set. */
  attempt: number;
  view: RangeView;
  /** The worst of the checks. */
  verdict: RangeVerdict;
  /** Correct and borderline reps count toward the set; incorrect ones do not. */
  counted: boolean;
  checks: RangeCheck[];
  /** The check to correct first: the worst, then the furthest out. Null when all are correct. */
  worst: RangeCheck | null;
  endedAt: number;
}

export type RangeTallyKey = 'knee' | 'back' | 'ankle' | 'tibia_left' | 'tibia_right';

export interface RangeTally {
  correct: number;
  borderline: number;
  incorrect: number;
}

export interface RangeSetSummary {
  attempts: number;
  /** Reps counted toward the set (correct + borderline). */
  counted: number;
  correct: number;
  borderline: number;
  incorrect: number;
  /** How each angle was judged across the set's reps. */
  angles: Partial<Record<RangeTallyKey, RangeTally>>;
}

/** This frame's reading of an angle, judged against the model, for colouring its label. */
export interface RangeLiveCheck {
  angle: RangeAngle;
  side?: BodySide;
  value: number;
  verdict: RangeVerdict;
}

export interface RangeSessionState {
  model: RangeModel;
  /** The view this set is judged in; null judges whichever view the patient shows. */
  requiredView: RangeView | null;
  /** The view seen this frame, null when nothing is tracked. */
  view: RangeView | null;
  /** Between the start of a rep and its return to standing. */
  inRep: boolean;
  /** Readings judged against the model while in a rep. Empty while standing. */
  live: RangeLiveCheck[];
  reps: readonly RangeRep[];
  lastRep: RangeRep | null;
  summary: RangeSetSummary;
  /** Front view: toe-out per leg from the last standing frames. */
  toeOut: Partial<Record<BodySide, number>>;
}

interface TimedSample {
  t: number;
  sample: RangeSample;
  depth: number;
}

const SIDES: readonly BodySide[] = ['left', 'right'];

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The value `share` of the way through `values`, sorted (0 lowest, 1 highest). */
function percentile(values: readonly number[], share: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
  return sorted[index];
}

function defined<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined);
}

function check(
  angle: RangeAngle,
  value: number,
  range: DegreeRange,
  toleranceDeg: number,
  extra: Partial<RangeCheck> = {},
): RangeCheck {
  const judged = judgeInRange(value, range, toleranceDeg);
  return { angle, value: round1(value), range, toleranceDeg, ...judged, offByDeg: round1(judged.offByDeg), ...extra };
}

function tallyKey(check: RangeCheck): RangeTallyKey {
  if (check.angle !== 'tibia') return check.angle;
  return check.side === 'right' ? 'tibia_right' : 'tibia_left';
}

/** Totals for a set's reps. */
export function summarizeRangeReps(reps: readonly RangeRep[]): RangeSetSummary {
  const summary: RangeSetSummary = { attempts: 0, counted: 0, correct: 0, borderline: 0, incorrect: 0, angles: {} };
  for (const rep of reps) {
    summary.attempts += 1;
    summary[rep.verdict] += 1;
    if (rep.counted) summary.counted += 1;
    for (const item of rep.checks) {
      const key = tallyKey(item);
      const tally = (summary.angles[key] ??= { correct: 0, borderline: 0, incorrect: 0 });
      tally[item.verdict] += 1;
    }
  }
  return summary;
}

/** Worst verdict first, then the reading furthest outside its range. */
function worstCheck(checks: readonly RangeCheck[]): RangeCheck | null {
  let worst: RangeCheck | null = null;
  for (const item of checks) {
    if (item.verdict === 'correct') continue;
    if (!worst) {
      worst = item;
      continue;
    }
    const byVerdict = compareVerdicts(item.verdict, worst.verdict);
    if (byVerdict > 0 || (byVerdict === 0 && item.offByDeg > worst.offByDeg)) worst = item;
  }
  return worst;
}

/**
 * Grades squat and lunge reps against a model (`angleRangeModels.ts`).
 *
 * A rep is found in the patient's own movement, not by the joint-angle rep counter: side on it
 * starts once the thigh leaves vertical by `sideEngageDeg` and ends back under `sideReleaseDeg`;
 * face on, the hips dropping toward the knees (no depth needed) start and end it. So a partial
 * OA squat is a rep, and a shallow attempt is a rep that is judged too shallow.
 *
 * Side on, the knee, back and (lunge) ankle are judged at the bottom: the middle reading over the
 * frames within a few degrees of the deepest one. Face on, each tibia is judged from the bottom
 * through the way up, against the range for the toe-out measured just before the rep started.
 */
export class RangeRepJudge {
  private readonly config: RangeJudgeConfig;
  private requiredView: RangeView | null = null;
  private rep: { samples: TimedSample[]; toeOut: Partial<Record<BodySide, number>> } | null = null;
  private lastRepSampleAt = -Infinity;
  /** Recent standing frames in the required view: the front view's hip height and toe-out come from them. */
  private standing: Array<{ t: number; sample: RangeSample }> = [];
  private reps: RangeRep[] = [];
  private lastView: RangeView | null = null;

  constructor(
    readonly model: RangeModel,
    config: Partial<RangeJudgeConfig> = {},
  ) {
    this.config = { ...VISION_CONFIG.rangeJudge, ...config };
  }

  setRequiredView(view: RangeView | null): void {
    if (view === this.requiredView) return;
    this.requiredView = view;
    this.rep = null;
    this.standing = [];
  }

  getRequiredView(): RangeView | null {
    return this.requiredView;
  }

  /** The next set: reps start over. */
  startNewSet(): void {
    this.reps = [];
    this.rep = null;
    this.standing = [];
    this.lastRepSampleAt = -Infinity;
  }

  reset(): void {
    this.startNewSet();
    this.lastView = null;
  }

  /** Frames while nothing is scored, as in the countdown: only the standing baseline learns from them. */
  observe(sample: RangeSample | null, timestamp: number): RangeSessionState {
    this.lastView = sample?.view ?? null;
    if (sample && this.accepts(sample)) {
      const depth = this.depthOf(sample);
      if (depth === undefined || depth < this.engageAt(sample.view)) this.rememberStanding(sample, timestamp);
    }
    return this.state([]);
  }

  update(sample: RangeSample | null, timestamp: number): RangeSessionState {
    this.lastView = sample?.view ?? null;
    const depth = sample && this.accepts(sample) ? this.depthOf(sample) : undefined;
    if (!sample || depth === undefined) {
      // Missing, unmeasurable or in the wrong view: a short gap keeps the rep, a long one drops it.
      if (this.rep && timestamp - this.lastRepSampleAt > this.config.maxGapMs) this.rep = null;
      return this.state([]);
    }

    if (!this.rep) {
      if (depth < this.engageAt(sample.view)) {
        this.rememberStanding(sample, timestamp);
        return this.state([]);
      }
      this.rep = { samples: [], toeOut: this.standingToeOut(timestamp) };
    }

    this.rep.samples.push({ t: timestamp, sample, depth });
    this.lastRepSampleAt = timestamp;
    const live = this.liveChecks(sample, this.rep.toeOut);

    if (depth <= this.releaseAt(sample.view)) {
      const finished = this.rep;
      this.rep = null;
      const first = finished.samples[0]!;
      if (timestamp - first.t >= this.config.minRepMs) {
        const judged = this.judgeRep(finished.samples, finished.toeOut, timestamp);
        if (judged) this.reps.push(judged);
      }
      this.rememberStanding(sample, timestamp);
      return this.state([]);
    }
    return this.state(live);
  }

  private accepts(sample: RangeSample): boolean {
    return this.requiredView === null || sample.view === this.requiredView;
  }

  private engageAt(view: RangeView): number {
    return view === 'side' ? this.config.sideEngageDeg : this.config.frontEngageDrop;
  }

  private releaseAt(view: RangeView): number {
    return view === 'side' ? this.config.sideReleaseDeg : this.config.frontReleaseDrop;
  }

  /** Larger is deeper. Side on, the thigh angle; face on, how far the hips dropped from standing. */
  private depthOf(sample: RangeSample): number | undefined {
    if (sample.view === 'side') return sample.knee;
    if (sample.hipRise === undefined) return undefined;
    const standing = median(defined(this.standing.map((entry) => entry.sample.hipRise)));
    // Nothing to measure the drop from until the patient has been seen standing.
    if (standing === undefined || standing <= 0) return 0;
    return Math.max(0, 1 - sample.hipRise / standing);
  }

  private rememberStanding(sample: RangeSample, timestamp: number): void {
    this.standing.push({ t: timestamp, sample });
    while (this.standing.length > this.config.standingFrames) this.standing.shift();
  }

  /** Toe-out per leg: the middle reading over the standing frames just before the rep. */
  private standingToeOut(timestamp: number): Partial<Record<BodySide, number>> {
    const recent = this.standing.filter((entry) => timestamp - entry.t <= this.config.toeOutWindowMs);
    const toeOut: Partial<Record<BodySide, number>> = {};
    for (const side of SIDES) {
      const value = median(defined(recent.map((entry) => entry.sample.toeOut?.[side])));
      if (value !== undefined) toeOut[side] = round1(value);
    }
    return toeOut;
  }

  private liveChecks(sample: RangeSample, toeOut: Partial<Record<BodySide, number>>): RangeLiveCheck[] {
    const live: RangeLiveCheck[] = [];
    for (const item of this.checksFor(sample, toeOut)) {
      live.push({ angle: item.angle, ...(item.side ? { side: item.side } : {}), value: item.value, verdict: item.verdict });
    }
    return live;
  }

  /** Every angle the model judges in this sample's view, judged as read. */
  private checksFor(sample: RangeSample, toeOut: Partial<Record<BodySide, number>>): RangeCheck[] {
    const model = this.model;
    const checks: RangeCheck[] = [];
    if (sample.view === 'side') {
      if (sample.knee !== undefined) checks.push(check('knee', sample.knee, model.knee, model.toleranceDeg));
      if (sample.back !== undefined) checks.push(check('back', sample.back, model.back, model.toleranceDeg));
      if (model.kind === 'lunge' && sample.ankle !== undefined) {
        checks.push(check('ankle', sample.ankle, model.ankle, model.toleranceDeg));
      }
      return checks;
    }
    if (model.kind !== 'squat') return checks;
    for (const side of SIDES) {
      const tibia = sample.tibia?.[side];
      const toe = toeOut[side];
      if (tibia === undefined || toe === undefined) continue;
      const band = tibiaBandFor(toe);
      checks.push(check('tibia', tibia, band.tibia, TIBIA_TOLERANCE_DEG, { side, toeOutDeg: toe }));
    }
    return checks;
  }

  private judgeRep(
    samples: readonly TimedSample[],
    toeOut: Partial<Record<BodySide, number>>,
    endedAt: number,
  ): RangeRep | null {
    const view = samples[0]!.sample.view;
    const maxDepth = Math.max(...samples.map((entry) => entry.depth));
    const window = view === 'side' ? this.config.sideBottomWindowDeg : this.config.frontBottomWindowDrop;
    const bottomFrom = samples.findIndex((entry) => entry.depth >= maxDepth - window);
    const checks: RangeCheck[] = [];
    const model = this.model;

    if (view === 'side') {
      const bottom = samples.filter((entry) => entry.depth >= maxDepth - window).map((entry) => entry.sample);
      const knee = median(defined(bottom.map((sample) => sample.knee)));
      const back = median(defined(bottom.map((sample) => sample.back)));
      const ankle = median(defined(bottom.map((sample) => sample.ankle)));
      if (knee !== undefined) checks.push(check('knee', knee, model.knee, model.toleranceDeg));
      if (back !== undefined) checks.push(check('back', back, model.back, model.toleranceDeg));
      if (model.kind === 'lunge' && ankle !== undefined) checks.push(check('ankle', ankle, model.ankle, model.toleranceDeg));
    } else if (model.kind === 'squat') {
      // From the bottom through the way up, until the hips are back above halfway.
      const rising = samples.slice(Math.max(0, bottomFrom)).filter((entry) => entry.depth >= maxDepth / 2);
      for (const side of SIDES) {
        const toe = toeOut[side];
        const values = defined(rising.map((entry) => entry.sample.tibia?.[side]));
        if (toe === undefined || values.length === 0) continue;
        const band = tibiaBandFor(toe);
        const low = percentile(values, this.config.tibiaPercentile)!;
        const high = percentile(values, 1 - this.config.tibiaPercentile)!;
        // A leg is off the way most of its frames lean: below the range wins only if further out.
        const lowOff = band.tibia.min - low;
        const highOff = high - band.tibia.max;
        const value = lowOff <= 0 && highOff <= 0 ? median(values)! : lowOff >= highOff ? low : high;
        checks.push(check('tibia', value, band.tibia, TIBIA_TOLERANCE_DEG, { side, toeOutDeg: toe }));
      }
    }

    // Nothing the model judges was seen (feet out of view, say): no verdict, so no rep.
    if (checks.length === 0) return null;
    const verdict = worstVerdict(checks.map((item) => item.verdict));
    return {
      attempt: this.reps.length + 1,
      view,
      verdict,
      counted: verdict !== 'incorrect',
      checks,
      worst: worstCheck(checks),
      endedAt,
    };
  }

  private state(live: RangeLiveCheck[]): RangeSessionState {
    const toeOut =
      this.rep?.toeOut ?? this.standingToeOut(this.standing[this.standing.length - 1]?.t ?? 0);
    return {
      model: this.model,
      requiredView: this.requiredView,
      view: this.lastView,
      inRep: this.rep !== null,
      live,
      reps: [...this.reps],
      lastRep: this.reps[this.reps.length - 1] ?? null,
      summary: summarizeRangeReps(this.reps),
      toeOut,
    };
  }
}
