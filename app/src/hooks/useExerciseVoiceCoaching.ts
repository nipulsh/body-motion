import { useCallback, useEffect, useRef } from 'react';
import type { FormFaultCode, RepPhase } from '@vision';
import {
  coachingForCountdownStep,
  coachingForExerciseTransition,
  coachingForFormFault,
  coachingForPositioning,
  coachingForRangeRep,
  coachingForRepPhase,
  coachingForRestEnding,
  coachingForRestStarted,
  coachingForViewPrompt,
  createCoachingThrottleState,
  createFormCoachingState,
  type CoachingDecision,
} from '../exercise/exerciseVoiceCoaching';
import type { CountdownStep } from '../exercise/sessionState';
import { useVoiceInstructions } from './useVoiceInstructions';

export function useExerciseVoiceCoaching(voiceEnabled: boolean) {
  const { speak, cancel } = useVoiceInstructions(voiceEnabled);
  const throttleRef = useRef(createCoachingThrottleState());
  const formThrottleRef = useRef(createFormCoachingState());
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

  /** `silent` tracks the phase without speaking, so the next rep count is not mistaken for a repeat. */
  const speakRepPhase = useCallback(
    (phase: RepPhase | null, repCount = 0, silent = false) => {
      if (!phase) return;
      if (silent) {
        previousPhaseRef.current = phase;
        return;
      }
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

  const speakFormFault = useCallback(
    (fault: FormFaultCode | null) => {
      const result = coachingForFormFault(fault, Date.now(), formThrottleRef.current);
      formThrottleRef.current = result.state;
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

  /** Squat or lunge model: say how a judged rep went. */
  const speakRangeRep = useCallback(
    (voiceText: string, attempt: number) => {
      deliver(coachingForRangeRep(voiceText, attempt));
    },
    [deliver],
  );

  /** Squat or lunge model: ask the patient to turn for this set's view. */
  const speakViewPrompt = useCallback(
    (voiceText: string) => {
      deliver(coachingForViewPrompt(voiceText));
    },
    [deliver],
  );

  const resetPhaseTracking = useCallback(() => {
    previousPhaseRef.current = null;
    throttleRef.current = createCoachingThrottleState();
    formThrottleRef.current = createFormCoachingState();
  }, []);

  return {
    speakCountdown,
    speakRestStarted,
    speakRestEnding,
    speakExerciseTransition,
    speakRepPhase,
    speakFormFault,
    speakPositioning,
    speakRangeRep,
    speakViewPrompt,
    resetPhaseTracking,
    cancel,
  };
}
