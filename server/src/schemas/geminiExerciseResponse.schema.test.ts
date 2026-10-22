import { describe, expect, it } from 'vitest';
import { getGeminiExercisePlanJsonSchema } from './geminiExerciseResponse.schema';

describe('getGeminiExercisePlanJsonSchema', () => {
  it('returns a Gemini-compatible schema for multi-exercise plans', () => {
    const schema = getGeminiExercisePlanJsonSchema() as {
      type?: string;
      properties?: {
        exercises?: {
          type?: string;
          minItems?: number;
          maxItems?: number;
          items?: { properties?: Record<string, unknown> };
        };
      };
    };

    expect(schema.type).toBe('object');
    expect(schema.properties?.exercises).toMatchObject({
      type: 'array',
      minItems: 5,
      maxItems: 6,
    });
    expect(schema.properties?.exercises?.items?.properties?.trackingRules).toBeDefined();
    expect(schema.properties?.exercises?.items?.properties?.id).toEqual({ type: 'string' });
  });
});
