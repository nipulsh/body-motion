import type { PoseResult } from '../types';
import { rangeModelFor, type RangeView } from './angleRangeModels';
import { DeadliftFormMonitor, type DeadliftFaultCode, type DeadliftFormResult } from './deadliftForm';
import type { BodySide } from './formCommon';
import { LungeFormMonitor, type LungeFaultCode, type LungeFormResult } from './lungeForm';
import type { RangeSessionState } from './rangeRepJudge';
import { ShoulderFormMonitor, type ShoulderFormResult } from './shoulderForm';
import { SquatFormMonitor, type SquatFaultCode, type SquatFormResult } from './squatForm';
import type { Exercise } from './types';

export type ExerciseFormResult =
  | ({ kind: 'squat' } & SquatFormResult)
  | ({ kind: 'lunge' } & LungeFormResult)
  | ({ kind: 'deadlift' } & DeadliftFormResult)
  | ({ kind: 'shoulder' } & ShoulderFormResult);

export type FormFaultCode = SquatFaultCode | LungeFaultCode | DeadliftFaultCode;

/** Whether correct/incorrect rep counts mean anything: only checks with form faults score reps. */
export function formScoresReps(form: ExerciseFormResult): boolean {
  switch (form.kind) {
    case 'squat':
    case 'lunge':
    case 'deadlift':
      return true;
    case 'shoulder':
      return false;
    default: {
      const exhaustive: never = form;
      return exhaustive;
    }
  }
}

/** The squat or lunge model's reps and verdicts, when a model was picked. */
export function formRanges(form: ExerciseFormResult | null | undefined): RangeSessionState | null {
  if (form?.kind === 'squat' || form?.kind === 'lunge') return form.ranges ?? null;
  return null;
}

/** "Forward lunge (right)" leads with the right leg; a name without a side is auto-detected. */
export function leadSideFromName(name: string): BodySide | null {
  if (/\bleft\b/i.test(name)) return 'left';
  if (/\bright\b/i.test(name)) return 'right';
  return null;
}

type ActiveMonitor =
  | { kind: 'squat'; monitor: SquatFormMonitor }
  | { kind: 'lunge'; monitor: LungeFormMonitor }
  | { kind: 'deadlift'; monitor: DeadliftFormMonitor }
  | { kind: 'shoulder'; monitor: ShoulderFormMonitor };

/** Runs the form analysis matching the exercise's `formCheck`, if it has one. */
export class ExerciseFormMonitor {
  private active: ActiveMonitor | null = null;
  private exerciseId: string | null = null;
  /** The squat or lunge model picked for this exercise (`Exercise.rangeModel`), if any. */
  private rangeModelId: string | null = null;
  private requiredView: RangeView | null = null;

  start(exercise: Exercise | null): void {
    this.exerciseId = exercise?.id ?? null;
    const formCheck = exercise?.formCheck;
    const model = rangeModelFor(formCheck, exercise?.rangeModel);
    this.rangeModelId = model?.id ?? null;
    if (!exercise || !formCheck) {
      this.active = null;
      return;
    }
    switch (formCheck) {
      case 'squat':
        this.active = { kind: 'squat', monitor: new SquatFormMonitor({}, model?.kind === 'squat' ? model : null) };
        break;
      case 'lunge':
        this.active = {
          kind: 'lunge',
          monitor: new LungeFormMonitor(leadSideFromName(exercise.name), {}, model?.kind === 'lunge' ? model : null),
        };
        break;
      case 'deadlift':
        this.active = { kind: 'deadlift', monitor: new DeadliftFormMonitor() };
        return;
      case 'shoulder':
        this.active = { kind: 'shoulder', monitor: new ShoulderFormMonitor() };
        return;
      default: {
        const exhaustive: never = formCheck;
        return exhaustive;
      }
    }
    this.active.monitor.setRequiredView(this.requiredView);
  }

  /**
   * The view this set's reps are judged in, for a squat or lunge model: side on for knee, back
   * and ankle, face on for the tibia. Null judges whichever view the patient shows.
   */
  setRequiredView(view: RangeView | null): void {
    this.requiredView = view;
    const active = this.active;
    if (active?.kind === 'squat' || active?.kind === 'lunge') active.monitor.setRequiredView(view);
  }

  /**
   * The next set. Same patient and same camera, so a squat (or a lunge with a model) keeps its
   * standing zero and a shoulder raise its resting position: the app also restarts the set as the
   * countdown ends, right after the zero was taken.
   */
  restartSet(exercise: Exercise | null): void {
    const active = this.active;
    const sameExercise =
      exercise !== null &&
      exercise.id === this.exerciseId &&
      exercise.formCheck === active?.kind &&
      (rangeModelFor(exercise.formCheck, exercise.rangeModel)?.id ?? null) === this.rangeModelId;
    const keepsZero =
      active?.kind === 'squat' || active?.kind === 'shoulder' || (active?.kind === 'lunge' && this.rangeModelId !== null);
    if (active && sameExercise && keepsZero) {
      active.monitor.startNewSet();
      return;
    }
    this.start(exercise);
  }

  reset(): void {
    this.active?.monitor.reset();
  }

  /**
   * Frames seen while nothing is scored, as in the countdown: squat and shoulder zeros use them,
   * and a lunge model's. With a squat or lunge model the frame comes back too, so the app can see
   * which way the patient faces before the set starts. Otherwise null.
   */
  observeStanding(pose: PoseResult | null, timestamp: number, frameAspect?: number): ExerciseFormResult | null {
    const active = this.active;
    if (active?.kind === 'squat') {
      const result = active.monitor.observeStanding(pose, timestamp, frameAspect);
      return result ? { kind: 'squat', ...result } : null;
    }
    if (active?.kind === 'lunge') {
      const result = active.monitor.observeStanding(pose, timestamp, frameAspect);
      return result ? { kind: 'lunge', ...result } : null;
    }
    if (active?.kind === 'shoulder') active.monitor.observeStanding(pose, timestamp, frameAspect);
    return null;
  }

  update(
    pose: PoseResult | null,
    timestamp: number,
    repCount: number,
    frameAspect?: number,
  ): ExerciseFormResult | null {
    const active = this.active;
    if (!active) return null;
    switch (active.kind) {
      case 'squat':
        return { kind: 'squat', ...active.monitor.update(pose, timestamp, repCount, frameAspect) };
      case 'lunge':
        return { kind: 'lunge', ...active.monitor.update(pose, timestamp, repCount, frameAspect) };
      case 'deadlift':
        return { kind: 'deadlift', ...active.monitor.update(pose, timestamp, repCount, frameAspect) };
      case 'shoulder':
        return { kind: 'shoulder', ...active.monitor.update(pose, timestamp, repCount, frameAspect) };
      default: {
        const exhaustive: never = active;
        return exhaustive;
      }
    }
  }
}
