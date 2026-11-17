import { describe, expect, it } from 'vitest';
import type { Exercise, RepDetectionResult } from '@vision';
import {
  formatMirrorRepCount,
  mirrorExerciseSnapshot,
  mirrorSnapshotsEqual,
  mirrorPanelFollowOffset,
} from './smartMirrorExercise';

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'shoulder_abduction',
    name: 'Shoulder Abduction',
    description: 'Raise the arm',
    targetBodyParts: ['shoulder'],
    difficulty: 'beginner',
    sets: 3,
    recommendedReps: 12,
    restSeconds: 20,
    instructions: [],
    safetyNotes: [],
    trackingRules: [],
    demoVideoUrl: null,
    ...overrides,
  };
}

function result(overrides: Partial<RepDetectionResult> = {}): RepDetectionResult {
  return {
    exerciseId: 'shoulder_abduction',
    repCount: 8,
    targetReps: 12,
    phase: 'REP_COMPLETED',
    valid: true,
    progress: 1,
    feedback: 'Good',
    rules: {},
    completed: false,
    ...overrides,
  };
}

describe('mirror exercise snapshot', () => {
  it('formats the live counter with two digits', () => {
    expect(formatMirrorRepCount(8, 12)).toBe('08 / 12');
    expect(formatMirrorRepCount(0, 12)).toBe('00 / 12');
    expect(formatMirrorRepCount(12, 12)).toBe('12 / 12');
  });

  it('uses the detector count for the active exercise', () => {
    expect(mirrorExerciseSnapshot(exercise(), result())).toEqual({
      exercise: exercise(),
      repCount: 8,
      targetReps: 12,
    });
  });

  it('does not keep the previous exercise count when the session changes exercise', () => {
    const next = exercise({
      id: 'knee_extension',
      name: 'Knee Extension',
      recommendedReps: 10,
      demoVideoUrl: null,
    });

    expect(mirrorExerciseSnapshot(next, result())).toEqual({
      exercise: next,
      repCount: 0,
      targetReps: 10,
    });
  });

  it('shows the exercise target before the first counted rep', () => {
    expect(mirrorExerciseSnapshot(exercise(), null)).toMatchObject({
      repCount: 0,
      targetReps: 12,
    });
  });

  it('returns an empty snapshot when no exercise session is active', () => {
    expect(mirrorExerciseSnapshot(null, result())).toEqual({
      exercise: null,
      repCount: null,
      targetReps: null,
    });
  });

  it('treats an unchanged count as the same snapshot', () => {
    const current = mirrorExerciseSnapshot(exercise(), result({ repCount: 3 }));
    const next = mirrorExerciseSnapshot(exercise(), result({ repCount: 3 }));
    const changed = mirrorExerciseSnapshot(exercise(), result({ repCount: 4 }));

    expect(mirrorSnapshotsEqual(current, next)).toBe(true);
    expect(mirrorSnapshotsEqual(current, changed)).toBe(false);
  });
});
describe('mirrorPanelFollowOffset', () => {
  it('moves the panel down by the same amount as the eyes', () => {
    expect(mirrorPanelFollowOffset(0, 38, 600, 1920)).toBe(0);
    expect(mirrorPanelFollowOffset(250, 38, 600, 1920)).toBe(250);
  });

  it('stops when the panel reaches the bottom of the screen', () => {
    expect(mirrorPanelFollowOffset(5000, 38, 600, 1920)).toBe(1920 - 38 - 600);
  });

  it('never moves the panel up', () => {
    expect(mirrorPanelFollowOffset(-100, 38, 600, 1920)).toBe(0);
    expect(mirrorPanelFollowOffset(100, 38, 2000, 1920)).toBe(0);
  });
});
