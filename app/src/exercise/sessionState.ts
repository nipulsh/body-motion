import type { RepPhase } from '@vision';

export type CountdownStep = 'ready' | 3 | 2 | 1 | 'start';

/** Brief ready beat, then a spoken 1, 2, 3. Counting starts as soon as 3 ends. */
export const COUNTDOWN_SEQUENCE: CountdownStep[] = ['ready', 1, 2, 3];

export type ExerciseEntryVoiceState = 'get_in_position' | 'countdown' | 'counting';

export const COUNTDOWN_STEP_MS: Record<CountdownStep, number> = {
  ready: 1200,
  3: 900,
  2: 900,
  1: 900,
  start: 900,
};

export type ExerciseSessionPhase =
  | 'countdown'
  | 'active'
  | 'paused'
  | 'rest'
  | 'exercise_transition'
  | 'session_complete';

export interface ExerciseSessionViewState {
  phase: ExerciseSessionPhase;
  exerciseIndex: number;
  currentSet: number;
  restSecondsRemaining: number;
  repCompletedFlash: boolean;
  countdownStep: CountdownStep | null;
}

export interface ExerciseSessionStats {
  startedAt: number;
  completedAt: number;
  totalReps: number;
  setsCompleted: number;
  exercisesCompleted: number;
}

export function createInitialSessionViewState(): ExerciseSessionViewState {
  return {
    phase: 'countdown',
    exerciseIndex: 0,
    currentSet: 1,
    restSecondsRemaining: 0,
    repCompletedFlash: false,
    countdownStep: 'ready',
  };
}

export function createInitialSessionStats(startedAt = Date.now()): ExerciseSessionStats {
  return {
    startedAt,
    completedAt: startedAt,
    totalReps: 0,
    setsCompleted: 0,
    exercisesCompleted: 0,
  };
}

export function isSetComplete(repCount: number, exercise: { recommendedReps: number }): boolean {
  return repCount >= exercise.recommendedReps;
}

export function shouldFinishExercise(currentSet: number, exercise: { sets: number }): boolean {
  return currentSet >= exercise.sets;
}

export function formatPhaseLabel(phase: RepPhase | null): string {
  switch (phase) {
    case 'READY':
      return 'Get ready';
    case 'MOVING_TO_TARGET':
      return 'Move toward target';
    case 'TARGET_REACHED':
    case 'HOLDING':
      return 'Hold';
    case 'RETURNING':
      return 'Return to starting position';
    case 'REP_COMPLETED':
      return 'Good';
    default:
      return 'Get ready';
  }
}

export function nextExerciseIndex(current: number, total: number): number | null {
  const next = current + 1;
  return next < total ? next : null;
}

export function formatCountdownLabel(step: CountdownStep): string {
  if (step === 'ready') return 'GET READY';
  if (step === 'start') return 'START';
  return String(step);
}

export function getNextCountdownStep(step: CountdownStep): CountdownStep | null {
  const index = COUNTDOWN_SEQUENCE.indexOf(step);
  if (index < 0 || index >= COUNTDOWN_SEQUENCE.length - 1) return null;
  return COUNTDOWN_SEQUENCE[index + 1] ?? null;
}

/** Ready is the only get-in-position beat. It always advances into the numeric countdown. */
export function leaveGetInPosition(step: CountdownStep): CountdownStep | null {
  if (step !== 'ready') return step;
  return getNextCountdownStep(step);
}

export function entryVoiceStateForCountdown(
  step: CountdownStep | null,
  phase: ExerciseSessionPhase,
): ExerciseEntryVoiceState {
  if (phase !== 'countdown') return 'counting';
  if (step === null || step === 'ready') return 'get_in_position';
  return 'countdown';
}

/** Positioning speech is a single ready beat, never a loop during the countdown or the set. */
export function shouldSpeakPositioning(
  phase: ExerciseSessionPhase,
  countdownStep: CountdownStep,
): boolean {
  return entryVoiceStateForCountdown(countdownStep, phase) === 'get_in_position';
}

export function formatSessionDuration(startedAt: number, completedAt: number): string | null {
  const totalSeconds = Math.max(0, Math.round((completedAt - startedAt) / 1000));
  if (totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
}

export function finalizeSessionStats(
  stats: ExerciseSessionStats,
  completedAt = Date.now(),
): ExerciseSessionStats {
  return { ...stats, completedAt };
}

export function isCameraPhase(phase: ExerciseSessionPhase): boolean {
  return phase === 'countdown' || phase === 'active' || phase === 'paused';
}

export function isTrackingPhase(phase: ExerciseSessionPhase, paused: boolean): boolean {
  return phase === 'active' && !paused;
}
