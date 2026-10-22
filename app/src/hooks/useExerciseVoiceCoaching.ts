import { useCallback, useEffect, useRef } from 'react';
import type { RepPhase } from '@vision';
import {
  coachingForCountdownStep,
  coachingForExerciseTransition,
  coachingForPositioning,
  coachingForRepPhase,
  coachingForRestEnding,
  coachingForRestStarted,
  createCoachingThrottleState,
  type CoachingDecision,
} from '../exercise/exerciseVoiceCoaching';
import type { CountdownStep } from '../exercise/sessionState';
import { useVoiceInstructions } from './useVoiceInstructions';

export function useExerciseVoiceCoaching(voiceEnabled: boolean) {
  const { speak, cancel } = useVoiceInstructions(voiceEnabled);
  const throttleRef = useRef(createCoachingThrottleState());
  const previousPhaseRef = useRef<RepPhase | null>(null);

  useEffect(() => {
    if (!voiceEnabled) cancel();
  }, [cancel, voiceEnabled]);

  const deliver = useCallback(
    (decision: CoachingDecision | null) => {
      if (!decision?.speak || !voiceEnabled) return;
      speak(decision.voiceText, { priority: decision.priority });
    },
    [speak, voiceEnabled],
  );

  const speakCountdown = useCallback(
    (step: CountdownStep) => {
      deliver(coachingForCountdownStep(step));
    },
    [deliver],
  );

  const speakRestStarted = useCallback(
    (restSeconds: number) => {
      throttleRef.current = createCoachingThrottleState();
      deliver(coachingForRestStarted(restSeconds));
    },
    [deliver],
  );

  const speakRestEnding = useCallback(() => {
    deliver(coachingForRestEnding());
  }, [deliver]);

  const speakExerciseTransition = useCallback(
    (exerciseName: string) => {
      deliver(coachingForExerciseTransition(exerciseName));
    },
    [deliver],
  );

  const speakRepPhase = useCallback(
    (phase: RepPhase | null, repCount = 0) => {
      if (!phase) return;
      const result = coachingForRepPhase(
        phase,
        previousPhaseRef.current,
        Date.now(),
        throttleRef.current,
        repCount,
      );
      throttleRef.current = result.state;
      previousPhaseRef.current = phase;
      deliver(result.decision);
    },
    [deliver],
  );

  const speakPositioning = useCallback(
    (message: string) => {
      deliver(coachingForPositioning(message));
    },
    [deliver],
  );

  const resetPhaseTracking = useCallback(() => {
    previousPhaseRef.current = null;
    throttleRef.current = createCoachingThrottleState();
  }, []);

  return {
    speakCountdown,
    speakRestStarted,
    speakRestEnding,
    speakExerciseTransition,
    speakRepPhase,
    speakPositioning,
    resetPhaseTracking,
    cancel,
  };
}
