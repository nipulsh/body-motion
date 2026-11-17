/** Second-round regression tests for the analysis guards (written before the fixes). */
import { toJSONSchema } from 'zod';
import { describe, expect, it } from 'vitest';
import { addressesFinding, buildResponseJsonSchema, validateMuscleNames } from './analysis.service';
import { geminiAnalysisResponseSchema } from '../../schemas/analysis.schema';
import { listCatalogueMuscleNames } from '../../config/muscleMap';
import { mergeDuplicateMuscles, normaliseContributions } from '../../utils/muscleContribution';
import type { PostureFinding } from '../../schemas/posture.schema';

const leftKnee: PostureFinding = {
  region: 'knee', side: 'left', metric: 'leftKneeFlexionDeg', value: 40, unit: 'deg', threshold: 15,
  severity: 2.67, muscleGroups: ['UPPER_LEG', 'LOWER_LEG'], description: 'Left knee held bent 40° while standing',
};

const answer = (bodyRegion: string, kneeRating: number) => ({
  bodyRegion,
  muscles: [{ name: 'Left Deltoid', side: 'left' }, { name: 'Left Biceps Femoris', side: 'left' }],
  regionAssessment: [
    { region: 'shoulder', severity: 0.9 },
    { region: 'knee', severity: kneeRating },
  ],
});

describe('#7 guard also weighs the stated primary bodyRegion', () => {
  it('rejects an answer that names another region and barely rates the measured one', () => {
    expect(addressesFinding(answer('Right shoulder girdle', 0.25), leftKnee)).toBe(false);
  });

  it('accepts a mild rating when the primary region is the measured one', () => {
    expect(addressesFinding(answer('Left knee', 0.25), leftKnee)).toBe(true);
  });

  it('accepts another primary region when the measured one is clearly acknowledged', () => {
    expect(addressesFinding(answer('Right shoulder girdle', 0.5), leftKnee)).toBe(true);
  });
});

describe('#10 the same muscle with conflicting side labels', () => {
  it('merges into one row, side taken from the name', () => {
    const merged = mergeDuplicateMuscles([
      { name: 'Left Deltoid', side: 'left', likelihood: 0.5, intensity: 0.5, reason: 'a', contributionPercent: 30 },
      { name: 'Left Deltoid', side: 'bilateral', likelihood: 0.5, intensity: 0.5, reason: 'b', contributionPercent: 30 },
      { name: 'Diaphragm', side: 'midline', likelihood: 0.5, intensity: 0.5, reason: 'c', contributionPercent: 10 },
      { name: 'Diaphragm', side: 'unknown', likelihood: 0.5, intensity: 0.5, reason: 'd', contributionPercent: 10 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.name === 'Left Deltoid')).toMatchObject({ side: 'left', contributionPercent: 60 });
  });
});

describe('#11 zero shares and rounding', () => {
  it('removes muscles the model gave an explicit 0% when others have a share', () => {
    const result = normaliseContributions([
      { name: 'A', likelihood: 0.9, intensity: 0.9, contributionPercent: 70 },
      { name: 'B', likelihood: 0.9, intensity: 0.9, contributionPercent: 30 },
      { name: 'Z', likelihood: 0.9, intensity: 0.9, contributionPercent: 0 },
    ]);
    expect(result.map((m) => m.name)).toEqual(['A', 'B']);
  });

  it('keeps tiny shares visible without distorting the large ones', () => {
    const result = normaliseContributions(
      Array.from({ length: 30 }, (_, i) => ({ name: `M${i}`, likelihood: 0.5, intensity: 0.5, contributionPercent: i === 0 ? 1000 : 0.01 })),
    );
    expect(result).toHaveLength(30);
    expect(Math.min(...result.map((m) => m.contributionPercent))).toBeGreaterThan(0);
    expect(result[0]!.contributionPercent).toBeGreaterThanOrEqual(97);
    expect(result.reduce((s, m) => s + m.contributionPercent, 0)).toBeCloseTo(100, 6);
  });

  it('sums to exactly 100 at 0.1 resolution for awkward splits', () => {
    const result = normaliseContributions([1, 1, 1].map((w, i) => ({ name: `T${i}`, likelihood: 0.5, intensity: 0.5, contributionPercent: w })));
    expect(result.map((m) => m.contributionPercent).sort()).toEqual([33.3, 33.3, 33.4]);
  });
});

describe('#17 muscle names are validated against the catalogue', () => {
  it('constrains Gemini to catalogue names in the response schema', () => {
    const schema = buildResponseJsonSchema() as {
      properties: { muscles: { items: { properties: { name: { enum?: string[] } } } } };
    };
    const allowed = schema.properties.muscles.items.properties.name.enum;
    expect(allowed).toEqual(listCatalogueMuscleNames());
    // The base zod schema stays lenient; validation happens server-side below.
    expect(JSON.stringify(toJSONSchema(geminiAnalysisResponseSchema))).not.toContain('"enum":["Diaphragm"');
  });

  it('drops names outside the catalogue and reports them', () => {
    const { valid, invalid } = validateMuscleNames([
      { name: 'Left Deltoid' },
      { name: 'Left Supercalifragilistic' },
      { name: 'Muscle of happiness' },
    ]);
    expect(valid.map((m) => m.name)).toEqual(['Left Deltoid']);
    expect(invalid).toEqual(['Left Supercalifragilistic', 'Muscle of happiness']);
  });
});
