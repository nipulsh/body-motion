import type { RepPhase } from '@vision';
import type { CountdownStep } from './sessionState';

export type CoachingPriority = 'normal' | 'high';

export interface CoachingThrottleState {
  lastKey: string | null;
  lastSpokenAt: number;
}

export interface CoachingDecision {
  speak: boolean;
  voiceText: string;
  key: string;
  priority: CoachingPriority;
}

const DEFAULT_MIN_INTERVAL_MS = 3500;

export function createCoachingThrottleState(): CoachingThrottleState {
  return { lastKey: null, lastSpokenAt: 0 };
}

export function shouldSpeakCoaching(
  state: CoachingThrottleState,
  key: string,
  now: number,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  priority: CoachingPriority = 'normal',
): boolean {
  if (priority === 'high') return true;
  if (state.lastKey !== key) return true;
  return now - state.lastSpokenAt >= minIntervalMs;
}

export function recordCoachingSpeech(
  _state: CoachingThrottleState,
  key: string,
  now: number,
): CoachingThrottleState {
  return { lastKey: key, lastSpokenAt: now };
}

export function mapPhaseToVoice(phase: RepPhase | null): string | null {
  switch (phase) {
    case 'READY':
      return 'Get ready';
    case 'MOVING_TO_TARGET':
      return 'Move toward the target';
    case 'TARGET_REACHED':
    case 'HOLDING':
      return 'Hold';
    case 'RETURNING':
      return 'Return to starting position';
    case 'REP_COMPLETED':
      return 'Good rep';
    default:
      return null;
  }
}

export function mapFeedbackToVoice(feedback: string | undefined): string | null {
  if (!feedback) return null;
  const normalized = feedback.toLowerCase();
  if (normalized === 'good') return 'Good rep';
  if (normalized === 'hold' || normalized === 'hold at target position') return 'Hold';
  if (normalized === 'move toward target position') return 'Move toward the target';
  if (normalized === 'return to starting position') return 'Return to starting position';
  if (normalized === 'exercise complete') return 'Exercise complete';
  if (normalized.includes('visible to the camera')) return 'Please move into position';
  if (normalized.includes('move toward target')) return 'Move toward the target';
  if (normalized.includes('move your')) return 'Move toward the target';
  return null;
}

export function coachingForRepPhase(
  phase: RepPhase,
  previousPhase: RepPhase | null,
  now: number,
  state: CoachingThrottleState,
  repCount = 0,
): { decision: CoachingDecision | null; state: CoachingThrottleState } {
  if (phase === 'READY') {
    return { decision: null, state };
  }

  if (phase === 'REP_COMPLETED') {
    if (previousPhase === 'REP_COMPLETED') {
      return { decision: null, state };
    }
    const voiceText = repCount > 0 ? String(repCount) : 'Good rep';
    return {
      decision: {
        speak: true,
        voiceText,
        key: `rep_completed:${voiceText}`,
        priority: 'high',
      },
      state: recordCoachingSpeech(state, `rep_completed:${voiceText}`, now),
    };
  }

  const voiceText = mapPhaseToVoice(phase);
  if (!voiceText) return { decision: null, state };

  const key = `phase:${phase}`;
  if (!shouldSpeakCoaching(state, key, now)) {
    return { decision: null, state };
  }

  return {
    decision: { speak: true, voiceText, key, priority: 'normal' },
    state: recordCoachingSpeech(state, key, now),
  };
}

export function coachingForRestStarted(restSeconds: number): CoachingDecision {
  return {
    speak: true,
    voiceText: `Set complete. Rest for ${restSeconds} seconds.`,
    key: 'rest_started',
    priority: 'high',
  };
}

export function coachingForRestEnding(): CoachingDecision {
  return {
    speak: true,
    voiceText: 'Get ready for the next set.',
    key: 'rest_ending',
    priority: 'high',
  };
}

export function coachingForExerciseTransition(exerciseName: string): CoachingDecision {
  return {
    speak: true,
    voiceText: `${exerciseName} complete.`,
    key: `exercise_complete:${exerciseName}`,
    priority: 'high',
  };
}

export function coachingForCountdownStep(step: CountdownStep): CoachingDecision | null {
  switch (step) {
    case 'ready':
      return { speak: true, voiceText: 'Get ready', key: 'countdown_ready', priority: 'high' };
    case 1:
    case 2:
    case 3:
      return {
        speak: true,
        voiceText: String(step),
        key: `countdown_${step}`,
        priority: 'high',
      };
    case 'start':
      return null;
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

export function coachingForPositioning(message: string): CoachingDecision | null {
  const normalized = message.toUpperCase();
  if (normalized.includes('FULL BODY')) {
    return {
      speak: true,
      voiceText: 'Make sure your full body is visible',
      key: 'position_full_body',
      priority: 'normal',
    };
  }
  if (normalized.includes('MOVE INTO POSITION')) {
    return {
      speak: true,
      voiceText: 'Please move into position',
      key: 'position_adjust',
      priority: 'normal',
    };
  }
  return null;
}
