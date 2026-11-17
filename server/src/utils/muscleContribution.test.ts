import { describe, expect, it } from 'vitest';
import { normaliseContributions } from './muscleContribution';
import { addressesFinding, dominantPostureFinding } from '../services/gemini/analysis.service';
import type { PostureMetrics } from '../schemas/posture.schema';

const muscle = (name: string, contributionPercent?: number, likelihood = 0.5, intensity = 0.5) => ({
  name,
  likelihood,
  intensity,
  ...(contributionPercent !== undefined ? { contributionPercent } : {}),
});

describe('normaliseContributions', () => {
  it('rescales shares to exactly 100 and sorts largest first', () => {
    const result = normaliseContributions([muscle('a', 10), muscle('b', 30), muscle('c', 20)]);
    expect(result.map((m) => m.name)).toEqual(['b', 'c', 'a']);
    expect(result.reduce((sum, m) => sum + m.contributionPercent, 0)).toBeCloseTo(100, 5);
    expect(result[0]!.contributionPercent).toBeCloseTo(50, 1);
  });

  it('derives shares from likelihood × intensity when none are given (older analyses)', () => {
    const result = normaliseContributions([
      { ...muscle('weak'), contributionPercent: 0, likelihood: 0.2, intensity: 0.5 },
      { ...muscle('strong'), contributionPercent: 0, likelihood: 0.8, intensity: 0.5 },
    ]);
    expect(result[0]!.name).toBe('strong');
    expect(result[0]!.contributionPercent).toBeCloseTo(80, 1);
    expect(result[1]!.contributionPercent).toBeCloseTo(20, 1);
  });

  it('handles any number of muscles', () => {
    const many = Array.from({ length: 17 }, (_, i) => muscle(`m${i}`, i + 1));
    const result = normaliseContributions(many);
    expect(result).toHaveLength(17);
    expect(result.reduce((sum, m) => sum + m.contributionPercent, 0)).toBeCloseTo(100, 5);
  });
});

describe('wrong-region guard', () => {
  const posture: PostureMetrics = {
    version: 1,
    frameCount: 20,
    frontalFrames: 12,
    sideFrames: 4,
    metrics: { leftKneeFlexionDeg: 38 },
    findings: [
      {
        region: 'knee',
        side: 'left',
        metric: 'leftKneeFlexionDeg',
        value: 38,
        unit: 'deg',
        threshold: 15,
        severity: 2.53,
        muscleGroups: ['UPPER_LEG', 'LOWER_LEG'],
        description: 'Left knee held bent 38° while standing',
      },
    ],
  };

  it('flags a shoulder-only answer for a measured bent knee', () => {
    const finding = dominantPostureFinding(posture)!;
    expect(finding.region).toBe('knee');
    const answer = (names: string[]) => ({
      muscles: names.map((name) => ({ name, side: 'left' })),
      regionAssessment: [{ region: 'knee', severity: 0.7 }],
    });
    expect(addressesFinding(answer(['Left Deltoid', 'Left Trapezius']), finding)).toBe(false);
    expect(addressesFinding(answer(['Left Deltoid', 'Left Biceps Femoris']), finding)).toBe(true);
  });

  it('ignores mild findings', () => {
    const mild = { ...posture, findings: [{ ...posture.findings[0]!, severity: 1.1 }] };
    expect(dominantPostureFinding(mild)).toBeNull();
  });
});
