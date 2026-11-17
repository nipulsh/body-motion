/**
 * Squat and lunge models: the correct range for each angle a model judges, from the clinical sheet
 * "Squat and Lunge Angle Ranges". This is the one place to tune them.
 *
 * These are starting values. A physio should check and tune them on real patients.
 *
 * Every angle is measured from a vertical line, 0° standing (see `squatForm.ts`, `lungeForm.ts`):
 *   - knee   (thigh)  the femur against a vertical line through the knee, about 90° with the thigh level
 *   - back   (trunk)  hip → shoulder against a vertical line through the hip
 *   - ankle  (shin)   ankle → knee against a vertical line through the ankle (lunge front leg)
 *   - tibia           front view: heel → knee against the vertical line at the heel, positive with
 *                     the knee outside that line, negative inside it
 */

export interface DegreeRange {
  min: number;
  max: number;
}

export type SquatModelId = 'knee_bias' | 'hip_bias' | 'long_femur' | 'oa_patient' | 'box_squat';
export type LungeModelId = 'knee_bias' | 'hip_bias';

export interface SquatRangeModel {
  kind: 'squat';
  id: SquatModelId;
  label: string;
  /** One line for the picker. */
  summary: string;
  knee: DegreeRange;
  back: DegreeRange;
  /** Degrees outside a range that still count as borderline. Further out is incorrect. */
  toleranceDeg: number;
}

export interface LungeRangeModel {
  kind: 'lunge';
  id: LungeModelId;
  label: string;
  summary: string;
  knee: DegreeRange;
  back: DegreeRange;
  ankle: DegreeRange;
  toleranceDeg: number;
}

export type RangeModel = SquatRangeModel | LungeRangeModel;

/** Values within this many degrees outside a range are borderline (OA and long femur differ). */
export const DEFAULT_RANGE_TOLERANCE_DEG = 5;

export const SQUAT_RANGE_MODELS: readonly SquatRangeModel[] = [
  {
    kind: 'squat',
    id: 'knee_bias',
    label: 'Knee bias',
    summary: 'Upright back, knees travel forward.',
    knee: { min: 90, max: 110 },
    back: { min: 15, max: 35 },
    toleranceDeg: DEFAULT_RANGE_TOLERANCE_DEG,
  },
  {
    kind: 'squat',
    id: 'hip_bias',
    label: 'Hip bias',
    summary: 'Sit the hips back with more forward lean.',
    knee: { min: 90, max: 110 },
    back: { min: 40, max: 60 },
    toleranceDeg: DEFAULT_RANGE_TOLERANCE_DEG,
  },
  {
    kind: 'squat',
    id: 'long_femur',
    label: 'Long femur',
    summary: 'Long thighs need more forward lean.',
    knee: { min: 85, max: 105 },
    back: { min: 45, max: 65 },
    toleranceDeg: 6,
  },
  {
    kind: 'squat',
    id: 'oa_patient',
    label: 'OA patient',
    summary: 'Partial squat: stay above parallel and pain free.',
    knee: { min: 45, max: 70 },
    back: { min: 15, max: 40 },
    toleranceDeg: 4,
  },
  {
    kind: 'squat',
    id: 'box_squat',
    label: 'Box squat',
    // The sheet: knee depth depends on box height and should be adjusted to the box.
    summary: 'Sit to the box. Knee range is set for a standard box.',
    knee: { min: 85, max: 100 },
    back: { min: 30, max: 55 },
    toleranceDeg: DEFAULT_RANGE_TOLERANCE_DEG,
  },
];

export const LUNGE_RANGE_MODELS: readonly LungeRangeModel[] = [
  {
    kind: 'lunge',
    id: 'knee_bias',
    label: 'Knee bias',
    summary: 'Upright back, front knee travels forward.',
    knee: { min: 80, max: 95 },
    back: { min: 0, max: 15 },
    ankle: { min: 25, max: 40 },
    toleranceDeg: DEFAULT_RANGE_TOLERANCE_DEG,
  },
  {
    kind: 'lunge',
    id: 'hip_bias',
    label: 'Hip bias',
    summary: 'Lean forward, front shin stays upright.',
    knee: { min: 80, max: 95 },
    back: { min: 25, max: 45 },
    ankle: { min: 0, max: 15 },
    toleranceDeg: DEFAULT_RANGE_TOLERANCE_DEG,
  },
];

/** Squat front view: the correct tibia range for a toe-out angle. More toe-out tilts the shin further out. */
export interface TibiaBand {
  toeOut: DegreeRange;
  tibia: DegreeRange;
}

export const TIBIA_TOE_OUT_BANDS: readonly TibiaBand[] = [
  { toeOut: { min: 0, max: 10 }, tibia: { min: 0, max: 8 } },
  { toeOut: { min: 10, max: 20 }, tibia: { min: 3, max: 12 } },
  { toeOut: { min: 20, max: 30 }, tibia: { min: 6, max: 18 } },
  { toeOut: { min: 30, max: 40 }, tibia: { min: 10, max: 24 } },
];

/** Tibia readings within this many degrees outside the range are borderline. */
export const TIBIA_TOLERANCE_DEG = 3;

/**
 * The band for a toe-out angle. Each band takes its lower edge (10° is in 10–20°). Toe-in reads
 * as the first band and anything past the table as the last: the sheet has nothing beyond them.
 */
export function tibiaBandFor(toeOutDeg: number): TibiaBand {
  const bands = TIBIA_TOE_OUT_BANDS;
  for (let i = bands.length - 1; i >= 0; i -= 1) {
    if (toeOutDeg >= bands[i]!.toeOut.min) return bands[i]!;
  }
  return bands[0]!;
}

export type RangeVerdict = 'correct' | 'borderline' | 'incorrect';

export interface RangeJudgement {
  verdict: RangeVerdict;
  /** Which side of the range the reading is on; null inside it. */
  off: 'low' | 'high' | null;
  /** Degrees outside the range; 0 inside it. */
  offByDeg: number;
}

/** Inside the range is correct, up to `toleranceDeg` outside it borderline, further out incorrect. */
export function judgeInRange(value: number, range: DegreeRange, toleranceDeg: number): RangeJudgement {
  if (value < range.min) {
    const offByDeg = range.min - value;
    return { verdict: offByDeg <= toleranceDeg ? 'borderline' : 'incorrect', off: 'low', offByDeg };
  }
  if (value > range.max) {
    const offByDeg = value - range.max;
    return { verdict: offByDeg <= toleranceDeg ? 'borderline' : 'incorrect', off: 'high', offByDeg };
  }
  return { verdict: 'correct', off: null, offByDeg: 0 };
}

const VERDICT_RANK: Record<RangeVerdict, number> = { correct: 0, borderline: 1, incorrect: 2 };

/** The worst of `verdicts`; correct when there are none. */
export function worstVerdict(verdicts: Iterable<RangeVerdict>): RangeVerdict {
  let worst: RangeVerdict = 'correct';
  for (const verdict of verdicts) {
    if (VERDICT_RANK[verdict] > VERDICT_RANK[worst]) worst = verdict;
  }
  return worst;
}

export function compareVerdicts(a: RangeVerdict, b: RangeVerdict): number {
  return VERDICT_RANK[a] - VERDICT_RANK[b];
}

/** Exercises that are judged against a model: the picker offers these. */
export type RangeModelFormCheck = RangeModel['kind'];

export function isRangeModelFormCheck(formCheck: string | null | undefined): formCheck is RangeModelFormCheck {
  return formCheck === 'squat' || formCheck === 'lunge';
}

export function rangeModelsFor(formCheck: RangeModelFormCheck): readonly RangeModel[] {
  return formCheck === 'squat' ? SQUAT_RANGE_MODELS : LUNGE_RANGE_MODELS;
}

/** The model `id` names for this exercise kind, or null when there is none by that id. */
export function rangeModelFor(formCheck: string | null | undefined, id: string | null | undefined): RangeModel | null {
  if (!id || !isRangeModelFormCheck(formCheck)) return null;
  return rangeModelsFor(formCheck).find((model) => model.id === id) ?? null;
}

/** Which view each angle is judged in: knee, back and ankle side on, tibia face on. */
export type RangeView = 'side' | 'front';
