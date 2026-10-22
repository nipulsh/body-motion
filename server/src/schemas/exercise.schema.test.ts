import { describe, expect, it } from 'vitest';
import {
  exerciseGenerationRequestSchema,
  exercisePlanSchema,
  trackingRuleSchema,
} from './exercise.schema';

describe('exerciseGenerationRequestSchema', () => {
  const analysisFromGetEndpoint = {
    bodyRegion: 'Shoulder',
    observedDeformation: 'Forward rounding',
    affectedSide: 'left' as const,
    summary: 'Test summary',
    muscles: [
      {
        name: 'Deltoid',
        side: 'left' as const,
        likelihood: 0.8,
        deformation: 'tight',
        intensity: 0.6,
        reason: 'test',
      },
    ],
  };

  it('accepts an empty body so the server can load analysis from storage', () => {
    expect(exerciseGenerationRequestSchema.safeParse({}).success).toBe(true);
    // Handler coalesces missing JSON body to {} before parsing.
    expect(exerciseGenerationRequestSchema.safeParse({} as Record<string, never>).success).toBe(true);
  });

  it('accepts a GET /analysis payload including affectedSide', () => {
    const result = exerciseGenerationRequestSchema.safeParse({
      analysis: analysisFromGetEndpoint,
    });
    expect(result.success).toBe(true);
  });

  it('rejects analysis that omits affectedSide', () => {
    const result = exerciseGenerationRequestSchema.safeParse({
      analysis: {
        bodyRegion: analysisFromGetEndpoint.bodyRegion,
        observedDeformation: analysisFromGetEndpoint.observedDeformation,
        summary: analysisFromGetEndpoint.summary,
        muscles: analysisFromGetEndpoint.muscles,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['analysis', 'affectedSide']);
    }
  });
});

describe('trackingRuleSchema', () => {
  it('accepts a valid rule', () => {
    const result = trackingRuleSchema.safeParse({
      joint: 'left_elbow',
      startAngle: 170,
      requiredAngle: 90,
      minimumAngle: 80,
      maximumAngle: 180,
      tolerance: 10,
      movement: 'flexion',
      startingPosition: 'Arm extended at side',
      targetPosition: 'Elbow bent to 90 degrees',
    });
    expect(result.success).toBe(true);
  });

  it('rejects requiredAngle outside min/max range', () => {
    const result = trackingRuleSchema.safeParse({
      joint: 'left_elbow',
      startAngle: 170,
      requiredAngle: 50,
      minimumAngle: 80,
      maximumAngle: 180,
      tolerance: 10,
      movement: 'flexion',
      startingPosition: 'Arm extended',
      targetPosition: 'Elbow bent',
    });
    expect(result.success).toBe(false);
  });
});

describe('exercisePlanSchema', () => {
  const baseExercise = {
    name: 'Test Exercise',
    description: 'A test exercise for schema validation.',
    targetBodyParts: ['shoulder'],
    difficulty: 'beginner' as const,
    sets: 3,
    recommendedReps: 10,
    restSeconds: 30,
    instructions: ['Step one'],
    safetyNotes: ['Stop if pain occurs'],
    trackingRules: [
      {
        joint: 'left_elbow' as const,
        startAngle: 170,
        requiredAngle: 90,
        minimumAngle: 80,
        maximumAngle: 180,
        tolerance: 10,
        movement: 'flexion' as const,
        startingPosition: 'Arm extended',
        targetPosition: 'Elbow bent to 90 degrees',
      },
    ],
  };

  it('requires 5–6 exercises with unique ids', () => {
    const exercises = Array.from({ length: 5 }, (_, index) => ({
      ...baseExercise,
      id: `exercise_${index}`,
    }));

    const result = exercisePlanSchema.safeParse({ exercises });
    expect(result.success).toBe(true);
  });

  it('rejects fewer than 5 exercises', () => {
    const exercises = [{ ...baseExercise, id: 'only_one' }];
    const result = exercisePlanSchema.safeParse({ exercises });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate exercise ids', () => {
    const exercises = Array.from({ length: 5 }, () => ({
      ...baseExercise,
      id: 'duplicate_id',
    }));
    const result = exercisePlanSchema.safeParse({ exercises });
    expect(result.success).toBe(false);
  });
});
