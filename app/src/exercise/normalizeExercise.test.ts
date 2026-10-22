import { describe, expect, it } from 'vitest';
import type { Exercise } from '@vision';
import { normalizeExercise } from './normalizeExercise';

const base: Exercise = {
  id: 'test',
  name: 'Test',
  description: 'Test',
  targetBodyParts: ['shoulder'],
  difficulty: 'beginner',
  sets: 2,
  recommendedReps: 8,
  restSeconds: 30,
  instructions: ['Move'],
  safetyNotes: ['Stop if pain'],
  trackingRules: [
    {
      joint: 'right_shoulder',
      startAngle: 20,
      requiredAngle: 90,
      minimumAngle: 10,
      maximumAngle: 120,
      tolerance: 8,
      movement: 'abduction',
      startingPosition: 'Start',
      targetPosition: 'Target',
      holdDurationSeconds: 2,
    },
  ],
};

describe('normalizeExercise', () => {
  it('clears isometric holds and widens tolerance for live tracking', () => {
    const normalized = normalizeExercise(base);
    expect(normalized.trackingRules[0]?.holdDurationSeconds).toBe(0);
    expect(normalized.trackingRules[0]?.tolerance).toBeGreaterThanOrEqual(10);
  });
});
