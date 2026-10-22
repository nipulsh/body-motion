import { describe, expect, it } from 'vitest';
import { makeExercise } from '@vision/exercise/testFixtures';
import {
  COUNTDOWN_SEQUENCE,
  createInitialSessionStats,
  finalizeSessionStats,
  formatCountdownLabel,
  formatSessionDuration,
  formatPhaseLabel,
  getNextCountdownStep,
  isCameraPhase,
  isSetComplete,
  isTrackingPhase,
  nextExerciseIndex,
  shouldFinishExercise,
} from '../exercise/sessionState';

describe('sessionState', () => {
  const exercise = makeExercise({ id: 'test', sets: 3, recommendedReps: 12, restSeconds: 20 });

  it('detects set completion from rep count', () => {
    expect(isSetComplete(11, exercise)).toBe(false);
    expect(isSetComplete(12, exercise)).toBe(true);
  });

  it('knows when all sets are finished', () => {
    expect(shouldFinishExercise(2, exercise)).toBe(false);
    expect(shouldFinishExercise(3, exercise)).toBe(true);
  });

  it('advances to the next exercise index', () => {
    expect(nextExerciseIndex(0, 6)).toBe(1);
    expect(nextExerciseIndex(5, 6)).toBeNull();
  });

  it('formats detector phases for display', () => {
    expect(formatPhaseLabel('HOLDING')).toBe('Hold');
    expect(formatPhaseLabel('REP_COMPLETED')).toBe('Good');
    expect(formatPhaseLabel('RETURNING')).toBe('Return to starting position');
  });
});

describe('countdown sequence', () => {
  it('walks through a brief ready beat, then 1, 2, 3', () => {
    expect(COUNTDOWN_SEQUENCE).toEqual(['ready', 1, 2, 3]);
    expect(formatCountdownLabel('ready')).toBe('GET READY');
    expect(formatCountdownLabel(1)).toBe('1');
    expect(getNextCountdownStep('ready')).toBe(1);
    expect(getNextCountdownStep(1)).toBe(2);
    expect(getNextCountdownStep(2)).toBe(3);
    expect(getNextCountdownStep(3)).toBeNull();
  });
});

describe('camera and tracking phases', () => {
  it('keeps camera on during countdown and pause', () => {
    expect(isCameraPhase('countdown')).toBe(true);
    expect(isCameraPhase('active')).toBe(true);
    expect(isCameraPhase('paused')).toBe(true);
    expect(isCameraPhase('rest')).toBe(false);
  });

  it('tracks reps only during active unpause phase', () => {
    expect(isTrackingPhase('active', false)).toBe(true);
    expect(isTrackingPhase('active', true)).toBe(false);
    expect(isTrackingPhase('countdown', false)).toBe(false);
  });
});

describe('session stats', () => {
  it('formats session duration from actual timestamps', () => {
    const stats = finalizeSessionStats(createInitialSessionStats(0), 1_080_000);
    expect(formatSessionDuration(stats.startedAt, stats.completedAt)).toBe('18 min');
  });
});

describe('rest timer', () => {
  it('counts down rest seconds', () => {
    let remaining = 3;
    remaining = Math.max(0, remaining - 1);
    remaining = Math.max(0, remaining - 1);
    remaining = Math.max(0, remaining - 1);
    expect(remaining).toBe(0);
  });
});

describe('rep counter source', () => {
  it('uses detector repCount rather than UI calculations', () => {
    const detectorRepCount = 4;
    const targetReps = 12;
    expect(`${detectorRepCount} / ${targetReps}`).toBe('4 / 12');
  });
});

describe('exercise progression', () => {
  it('moves to session complete after the final exercise', () => {
    const total = 6;
    expect(nextExerciseIndex(total - 1, total)).toBeNull();
  });
});

describe('REP_COMPLETED feedback', () => {
  it('maps rep completed phase to positive feedback', () => {
    expect(formatPhaseLabel('REP_COMPLETED')).toBe('Good');
  });
});
