import { describe, expect, it } from 'vitest';
import type { ExerciseFormResult } from '@vision';
import {
  activeFormFault,
  coachingForCountdownStep,
  coachingForFormFault,
  coachingForRestStarted,
  coachingForRepPhase,
  createCoachingThrottleState,
  createFormCoachingState,
  formFaultCorrection,
  recordCoachingSpeech,
  shouldSpeakCoaching,
} from './exerciseVoiceCoaching';

describe('squat form corrections', () => {
  const form = (sustained: boolean): ExerciseFormResult => ({
    kind: 'squat',
    frame: null,
    faults: [
      { code: 'left_knee_inward', since: 0, sustained },
      { code: 'shoulders_uneven', since: 0, sustained: true },
    ],
    correctReps: 0,
    incorrectReps: 0,
  });

  it('picks the highest-priority sustained fault', () => {
    expect(activeFormFault(form(true))).toBe('left_knee_inward');
    expect(activeFormFault(form(false))).toBe('shoulders_uneven');
    expect(activeFormFault(null)).toBeNull();
  });

  it('speaks a correction immediately, then repeats it only after a pause', () => {
    let state = createFormCoachingState();
    const first = coachingForFormFault('left_knee_inward', 1000, state);
    expect(first.decision).toMatchObject({ voiceText: 'Push your left knee out, keep it over your toes' });
    state = first.state;
    expect(coachingForFormFault('left_knee_inward', 3000, state).decision).toBeNull();
    expect(coachingForFormFault('left_knee_inward', 5000, state).decision).not.toBeNull();
    expect(coachingForFormFault(null, 9000, state).decision).toBeNull();
  });

  it('spaces out corrections when two faults alternate', () => {
    let state = createFormCoachingState();
    state = coachingForFormFault('left_knee_inward', 1000, state).state;
    expect(coachingForFormFault('hips_uneven', 1500, state).decision).toBeNull();
    const hips = coachingForFormFault('hips_uneven', 4000, state);
    expect(hips.decision?.voiceText).toBe('Keep your hips level');
    state = hips.state;
    // The knee was last spoken at 1000, but the gap since the hips correction still applies.
    expect(coachingForFormFault('left_knee_inward', 5500, state).decision).toBeNull();
    expect(coachingForFormFault('left_knee_inward', 7000, state).decision).not.toBeNull();
  });
});

describe('deadlift form corrections', () => {
  it('describes possible rounding without calling it an injury', () => {
    expect(formFaultCorrection('possible_upper_back_rounding')).toBe('Your upper back may be rounding');
    expect(formFaultCorrection('possible_lower_back_rounding')).toBe('Your lower back may be rounding');
    expect(formFaultCorrection('possible_combined_rounding')).toBe('Your upper and lower back may be rounding');
  });
});

describe('exerciseVoiceCoaching throttling', () => {
  it('does not repeat the same normal-priority message immediately', () => {
    const state = createCoachingThrottleState();
    const now = 10_000;
    expect(shouldSpeakCoaching(state, 'phase:HOLDING', now)).toBe(true);
    const next = recordCoachingSpeech(state, 'phase:HOLDING', now);
    expect(shouldSpeakCoaching(next, 'phase:HOLDING', now + 500)).toBe(false);
    expect(shouldSpeakCoaching(next, 'phase:HOLDING', now + 4000)).toBe(true);
  });

  it('allows high-priority messages immediately', () => {
    const state = recordCoachingSpeech(createCoachingThrottleState(), 'rest_started', 1000);
    expect(shouldSpeakCoaching(state, 'countdown_start', 1100, 3500, 'high')).toBe(true);
  });

  it('speaks the running rep count once per completed rep', () => {
    const state = createCoachingThrottleState();
    const first = coachingForRepPhase('REP_COMPLETED', 'RETURNING', 1000, state, 1);
    expect(first.decision?.voiceText).toBe('1');
    const second = coachingForRepPhase('REP_COMPLETED', 'REP_COMPLETED', 1200, first.state, 1);
    expect(second.decision).toBeNull();
    const third = coachingForRepPhase('REP_COMPLETED', 'RETURNING', 2000, second.state, 2);
    expect(third.decision?.voiceText).toBe('2');
  });

  it('provides a spoken 1, 2, 3 countdown and rest coaching', () => {
    expect(coachingForCountdownStep('ready')?.voiceText).toBe('Get ready');
    expect(coachingForCountdownStep(1)?.voiceText).toBe('1');
    expect(coachingForCountdownStep(2)?.voiceText).toBe('2');
    expect(coachingForCountdownStep(3)?.voiceText).toBe('3');
    expect(coachingForCountdownStep('start')).toBeNull();
    expect(coachingForRestStarted(30)?.voiceText).toBe('Set complete. Rest for 30 seconds.');
  });
});
