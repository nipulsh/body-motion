/** P0 #5: posture data from the client is numbers only, checked for internal consistency. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { POSTURE_METRIC_RULES, sanitizePostureMetrics } from './postureMetricRules';
import { dominantPostureFinding } from '../services/gemini/analysis.service';

const base = {
  version: 1,
  frameCount: 30,
  frontalFrames: 12,
  sideFrames: 8,
  metrics: { leftKneeFlexionDeg: 40, rightKneeFlexionDeg: 5, kneeFlexionAsymmetryDeg: 35, shoulderTiltDeg: 6 },
};

describe('#5 consistency checks', () => {
  it('rejects more measured frames than images were uploaded', () => {
    expect(sanitizePostureMetrics({ ...base, frameCount: 500 }, { uploadedImages: 30 })).toBeNull();
    expect(sanitizePostureMetrics(base, { uploadedImages: 30 })).not.toBeNull();
  });

  it('rejects frame counts that do not add up', () => {
    expect(sanitizePostureMetrics({ ...base, frontalFrames: 25, sideFrames: 25 })).toBeNull();
  });

  it('drops front-view metrics when no front-view frames were measured', () => {
    const clean = sanitizePostureMetrics({ ...base, frontalFrames: 0 })!;
    expect(clean.metrics.shoulderTiltDeg).toBeUndefined();
    expect(clean.metrics.leftKneeFlexionDeg).toBe(40);
  });

  it('drops an asymmetry whose sign contradicts the per-side values', () => {
    const clean = sanitizePostureMetrics({ ...base, metrics: { ...base.metrics, kneeFlexionAsymmetryDeg: -35 } })!;
    expect(clean.metrics.kneeFlexionAsymmetryDeg).toBeUndefined();
  });

  it('does not let a handful of frames trigger the paid re-ask', () => {
    const few = sanitizePostureMetrics({ ...base, frameCount: 2, frontalFrames: 2, sideFrames: 0 });
    expect(few === null || dominantPostureFinding(few) === null).toBe(true);
  });

  it('computes severity itself from the threshold', () => {
    const clean = sanitizePostureMetrics({ ...base, findings: [{ severity: 999 }] })!;
    const knee = clean.findings.find((f) => f.metric === 'leftKneeFlexionDeg')!;
    expect(knee.severity).toBeCloseTo(40 / POSTURE_METRIC_RULES.leftKneeFlexionDeg!.threshold, 2);
  });
});

describe('#5 server rules mirror the client table exactly', () => {
  it('matches thresholds, regions, units, muscle groups, sides and wording', async () => {
    const visionPath = path.resolve(__dirname, '../../../vision/pose/postureMetrics.ts');
    const { METRIC_INFO } = await import(pathToFileURL(visionPath).href);
    expect(Object.keys(POSTURE_METRIC_RULES).sort()).toEqual(Object.keys(METRIC_INFO).sort());
    for (const [key, rule] of Object.entries(POSTURE_METRIC_RULES)) {
      const client = METRIC_INFO[key];
      expect({ t: rule.threshold, r: rule.region, u: rule.unit, g: rule.muscleGroups, s: rule.signed, side: rule.side }, key).toEqual({
        t: client.threshold, r: client.region, u: client.unit, g: client.muscleGroups, s: client.signed, side: client.side,
      });
      for (const value of [-12.3, 7, 30]) {
        expect(rule.describe(value), `${key}(${value})`).toBe(client.describe(value));
      }
    }
  });
});
