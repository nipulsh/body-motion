import {
  isRangeModelFormCheck,
  rangeModelFor,
  type DegreeRange,
  type Exercise,
  type RangeCheck,
  type RangeModel,
  type RangeRep,
  type RangeSetSummary,
  type RangeTallyKey,
  type RangeView,
} from '@vision';

/**
 * Squat and lunge models in a session: the front or side choice, what the patient is told, and
 * how a set is summed up. The ranges themselves live in `vision/exercise/angleRangeModels.ts`.
 */

/**
 * Squats and lunges first ask front or side. Front runs the standard form check with no model;
 * side asks for a model and judges only that model's angles.
 */
export function needsViewChoice(exercise: Pick<Exercise, 'formCheck' | 'modality'> | null | undefined): boolean {
  return Boolean(exercise) && exercise?.modality !== 'hand_trace' && isRangeModelFormCheck(exercise?.formCheck);
}

/** What the patient chose before the first set: front (no model) or side with a model. */
export type ViewChoice = { view: 'front'; kind: RangeModel['kind'] } | { view: 'side'; model: RangeModel };

/** The exercise's picked model, if any. */
export function pickedRangeModel(exercise: Pick<Exercise, 'formCheck' | 'rangeModel'> | null | undefined): RangeModel | null {
  return rangeModelFor(exercise?.formCheck, exercise?.rangeModel);
}

/**
 * A model's angles (knee and back, and the lunge's ankle) are measured side on, so every set with
 * a model is done side on. Without a model nothing is required: the standard check takes either view.
 */
export function requiredViewFor(model: RangeModel | null): RangeView | null {
  return model ? 'side' : null;
}

/** The angles a model judges, for the patient: "knee and back" or "front knee, back and ankle". */
export function modelAnglesPhrase(kind: RangeModel['kind']): string {
  return kind === 'lunge' ? 'front knee, back and ankle' : 'knee and back';
}

/** The front or side choice, as offered before the first set. */
export function viewChoiceOptions(kind: RangeModel['kind']): Array<{ view: RangeView; label: string; detail: string }> {
  return [
    {
      view: 'front',
      label: 'Front',
      detail:
        kind === 'lunge'
          ? 'Face the camera. Standard check: the front knee stays in line with the foot.'
          : 'Face the camera. Standard form checks.',
    },
    {
      view: 'side',
      label: 'Side',
      detail: `Side on to the camera. Pick a type, then only its ${modelAnglesPhrase(kind)} angles are checked.`,
    },
  ];
}

/** Spoken and shown while the patient is not yet facing the way this set needs. */
export function viewPrompt(view: RangeView): string {
  return view === 'side'
    ? 'Turn to your left or right, so your side faces the camera'
    : 'Turn to face the camera';
}

export function viewPromptShort(view: RangeView): string {
  return view === 'side' ? 'TURN SIDEWAYS TO THE CAMERA' : 'FACE THE CAMERA';
}

/** What this set checks, for the screen. */
export function setViewDescription(model: RangeModel, view: RangeView): string {
  if (view === 'front') return 'Facing the camera: knee tracking (tibia) against toe-out';
  return `Side on: ${modelAnglesPhrase(model.kind)} only`;
}

export function formatRange(range: DegreeRange): string {
  return `${range.min}–${range.max}°`;
}

/** The model's ranges in one line, for the picker. */
export function modelRangesLine(model: RangeModel): string {
  const parts = [`Knee ${formatRange(model.knee)}`, `Back ${formatRange(model.back)}`];
  if (model.kind === 'lunge') parts.push(`Ankle ${formatRange(model.ankle)}`);
  return parts.join(' · ');
}

function sideName(check: RangeCheck): string {
  return check.side === 'right' ? 'right' : 'left';
}

/** How to fix one out-of-range angle, worded for the patient. */
export function rangeCorrection(check: RangeCheck, model: RangeModel): string {
  const lunge = model.kind === 'lunge';
  switch (check.angle) {
    case 'knee':
      if (check.off === 'low') return lunge ? 'Lower a little further' : 'Go a little deeper';
      if (model.kind === 'squat' && model.id === 'oa_patient') return 'Not so deep, stay above parallel';
      return lunge ? 'Do not drop so low' : 'Do not go so deep';
    case 'back':
      return check.off === 'low' ? 'Lean your chest forward a little more' : 'Keep your chest more upright';
    case 'ankle':
      return check.off === 'low' ? 'Let your front knee move further forward' : 'Keep your front shin more upright';
    case 'tibia':
      return check.off === 'low'
        ? `Push your ${sideName(check)} knee out`
        : `Do not push your ${sideName(check)} knee out so far`;
    default: {
      const exhaustive: never = check.angle;
      return exhaustive;
    }
  }
}

/** Spoken after a rep: the count for a counted rep, the correction for an incorrect one. */
export function rangeRepVoice(rep: RangeRep, countedReps: number, model: RangeModel): string {
  if (rep.counted) return String(countedReps);
  return rep.worst ? `Not counted. ${rangeCorrection(rep.worst, model)}` : 'Not counted';
}

/** Shown after a rep, until the next one. */
export function rangeRepFeedback(rep: RangeRep, model: RangeModel): { text: string; tone: 'good' | 'borderline' | 'incorrect' } {
  if (rep.verdict === 'correct') return { text: 'GOOD REP', tone: 'good' };
  const hint = rep.worst ? rangeCorrection(rep.worst, model).toUpperCase() : '';
  if (rep.verdict === 'borderline') return { text: hint ? `COUNTED, NEARLY: ${hint}` : 'COUNTED, NEARLY', tone: 'borderline' };
  return { text: hint ? `NOT COUNTED: ${hint}` : 'NOT COUNTED', tone: 'incorrect' };
}

export const RANGE_TALLY_LABELS: Record<RangeTallyKey, string> = {
  knee: 'Knee',
  back: 'Back',
  ankle: 'Ankle',
  tibia_left: 'Left tibia',
  tibia_right: 'Right tibia',
};

const TALLY_ORDER: readonly RangeTallyKey[] = ['knee', 'back', 'ankle', 'tibia_left', 'tibia_right'];

export interface RangeSummaryRow {
  key: RangeTallyKey;
  label: string;
  correct: number;
  borderline: number;
  incorrect: number;
}

/** One row per judged angle, in a fixed order. */
export function rangeSummaryRows(summary: RangeSetSummary): RangeSummaryRow[] {
  return TALLY_ORDER.flatMap((key) => {
    const tally = summary.angles[key];
    return tally ? [{ key, label: RANGE_TALLY_LABELS[key], ...tally }] : [];
  });
}

/** A finished set, kept for the summary shown after it. */
export interface CompletedRangeSet {
  setNumber: number;
  view: RangeView;
  model: RangeModel;
  summary: RangeSetSummary;
}
