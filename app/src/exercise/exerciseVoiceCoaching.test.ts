import { describe, expect, it } from 'vitest';
import {
  coachingForCountdownStep,
  coachingForRestStarted,
  coachingForRepPhase,
  createCoachingThrottleState,
  recordCoachingSpeech,
  shouldSpeakCoaching,
} from './exerciseVoiceCoaching';

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
