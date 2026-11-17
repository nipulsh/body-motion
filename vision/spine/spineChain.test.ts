import { describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../config';
import { H, W } from '../test/deadliftHinge';
import { chainFor, type ChainOptions } from '../test/spineChain';
import type { PoseSpine } from '../types';
import { measureSpineChain, type SpineChainContext } from './spineChain';

const CONFIG = VISION_CONFIG.spinePose.chain;
const ASPECT = W / H;

/** The MediaPipe trunk the chain is checked against, matching the fixture's body. */
function context(options: ChainOptions = {}, overrides: Partial<SpineChainContext> = {}): SpineChainContext {
  const { facing = 'right', leanDeg = 50 } = options;
  const dir = facing === 'right' ? 1 : -1;
  const lean = (leanDeg * Math.PI) / 180;
  const hipPx = { x: (320 / W) * ASPECT, y: (230 + (options.hipShiftY ?? 0)) / H };
  const lengthPx = 110 / H;
  return {
    aspect: ASPECT,
    hip: hipPx,
    shoulder: { x: hipPx.x + dir * Math.sin(lean) * lengthPx, y: hipPx.y - Math.cos(lean) * lengthPx },
    chest: { x: dir * Math.cos(lean), y: Math.sin(lean) },
    ...overrides,
  };
}

function read(options: ChainOptions = {}, overrides: Partial<SpineChainContext> = {}) {
  return measureSpineChain(chainFor(options), context(options, overrides), CONFIG);
}

function reading(options: ChainOptions = {}) {
  const result = read(options);
  if (!result.ok) throw new Error(`rejected: ${result.reason}`);
  return result.reading;
}

describe('measureSpineChain shape', () => {
  it('reads a straight spine as no curvature at any lean, so a hip hinge is not a bend', () => {
    for (const leanDeg of [0, 20, 50, 70, 90]) {
      const r = reading({ leanDeg });
      expect(Math.abs(r.overall)).toBeLessThan(1e-6);
      expect(Math.abs(r.lumbar)).toBeLessThan(1e-6);
      expect(Math.abs(r.thoracic)).toBeLessThan(1e-6);
      expect(Math.abs(r.bendDeg)).toBeLessThan(1e-3);
    }
  });

  it('reads a rounded back as positive and recovers the size of an even arc in every window', () => {
    const r = reading({ bulge: 0.1 });
    expect(r.overall).toBeCloseTo(0.1, 5);
    expect(r.lumbar).toBeCloseTo(0.1, 5);
    expect(r.midThoracic).toBeCloseTo(0.1, 5);
    expect(r.thoracic).toBeCloseTo(0.1, 5);
    expect(r.bendDeg).toBeGreaterThan(15);
  });

  it('reads a hollow back as negative', () => {
    const r = reading({ bulge: -0.08 });
    expect(r.overall).toBeCloseTo(-0.08, 5);
    expect(r.bendDeg).toBeLessThan(-10);
  });

  it('gives the same numbers facing either way', () => {
    const right = reading({ bulge: 0.07, facing: 'right' });
    const left = reading({ bulge: 0.07, facing: 'left' });
    expect(left.overall).toBeCloseTo(right.overall, 6);
    expect(left.lumbar).toBeCloseTo(right.lumbar, 6);
    expect(left.thoracic).toBeCloseTo(right.thoracic, 6);
    expect(left.bendDeg).toBeCloseTo(right.bendDeg, 6);
  });

  it('does not depend on lean or on how large the person is in the frame', () => {
    const base = reading({ bulge: 0.08, leanDeg: 30 });
    const hinged = reading({ bulge: 0.08, leanDeg: 75 });
    expect(hinged.overall).toBeCloseTo(base.overall, 6);
    const spine = chainFor({ bulge: 0.08, leanDeg: 30 });
    const ctx = context({ leanDeg: 30 });
    const half: PoseSpine = {
      ...spine,
      points: spine.points.map((p) => ({ ...p, x: (p.x - 0.5) / 2 + 0.5, y: (p.y - 0.5) / 2 + 0.5 })),
    };
    const halfCtx: SpineChainContext = {
      ...ctx,
      hip: { x: (ctx.hip.x - ASPECT / 2) / 2 + ASPECT / 2, y: (ctx.hip.y - 0.5) / 2 + 0.5 },
      shoulder: { x: (ctx.shoulder.x - ASPECT / 2) / 2 + ASPECT / 2, y: (ctx.shoulder.y - 0.5) / 2 + 0.5 },
    };
    const smaller = measureSpineChain(half, halfCtx, CONFIG);
    expect(smaller.ok && smaller.reading.overall).toBeCloseTo(base.overall, 6);
  });

  it('corrects for the frame aspect: a square-pixel straight chain stays straight', () => {
    // At 16:9, normalized x is squeezed. Ignoring the aspect would bend a hinged chain.
    expect(Math.abs(reading({ leanDeg: 45 }).overall)).toBeLessThan(1e-6);
  });

  it('separates lower-back rounding from upper-back rounding', () => {
    const lower = reading({ lumbarBulge: 0.08 });
    expect(lower.lumbar).toBeGreaterThan(0.03);
    expect(Math.abs(lower.thoracic)).toBeLessThan(0.005);
    const upper = reading({ thoracicBulge: 0.08 });
    expect(upper.thoracic).toBeGreaterThan(0.03);
    expect(Math.abs(upper.lumbar)).toBeLessThan(0.005);
  });

  it('reports confidence from the weakest station and keeps every point', () => {
    const r = reading({ score: 0.7 });
    expect(r.confidence).toBeCloseTo(0.7 / CONFIG.fullPointScore, 5);
    expect(r.points).toHaveLength(9);
    expect(reading({ score: 2 }).confidence).toBe(1);
  });

  it('ignores the two neck points when judging the back', () => {
    const spine = chainFor({ bulge: 0.05 });
    const ctx = context();
    const baseline = measureSpineChain(spine, ctx, CONFIG);
    const moved: PoseSpine = {
      ...spine,
      points: spine.points.map((p, i) => (i >= 7 ? { ...p, x: p.x + 0.04 } : p)),
    };
    const after = measureSpineChain(moved, ctx, CONFIG);
    expect(after.ok && baseline.ok && after.reading.overall).toBeCloseTo(baseline.ok ? baseline.reading.overall : 0, 8);
  });
});

describe('measureSpineChain rejects what it cannot trust', () => {
  const reasonOf = (spine: PoseSpine, ctx: SpineChainContext = context()) => {
    const result = measureSpineChain(spine, ctx, CONFIG);
    return result.ok ? 'ok' : result.reason;
  };

  it('accepts a good chain', () => {
    expect(reasonOf(chainFor())).toBe('ok');
  });

  it('rejects the wrong number of points', () => {
    expect(reasonOf({ points: chainFor().points.slice(0, 5), capturedAt: 0 })).toBe('bad_shape');
    expect(reasonOf({ points: [], capturedAt: 0 })).toBe('bad_shape');
  });

  it('rejects points that are not numbers', () => {
    const spine = chainFor();
    spine.points[3] = { x: Number.NaN, y: 0.5, score: 1 };
    expect(reasonOf(spine)).toBe('bad_shape');
    const infinite = chainFor();
    infinite.points[2] = { x: 0.5, y: Number.POSITIVE_INFINITY, score: 1 };
    expect(reasonOf(infinite)).toBe('bad_shape');
  });

  it('rejects when any back station is weak, but not when only the neck is', () => {
    const weak = chainFor();
    weak.points[4] = { ...weak.points[4]!, score: CONFIG.minPointScore - 0.05 };
    expect(reasonOf(weak)).toBe('low_confidence');
    const neck = chainFor();
    neck.points[8] = { ...neck.points[8]!, score: 0.01 };
    expect(reasonOf(neck)).toBe('ok');
  });

  it('rejects a chain that doubles back on itself', () => {
    const spine = chainFor();
    const tmp = spine.points[2]!;
    spine.points[2] = spine.points[4]!;
    spine.points[4] = tmp;
    expect(reasonOf(spine)).toBe('folded');
  });

  it('rejects an impossible bulge, however confident', () => {
    expect(reasonOf(chainFor({ bulge: 0.6 }))).toBe('implausible');
  });

  it('rejects a chain collapsed to one point', () => {
    const spine = chainFor();
    spine.points = spine.points.map((p) => ({ ...p, x: 0.5, y: 0.5 }));
    expect(reasonOf(spine)).toBe('bad_shape');
  });

  it('rejects a chain whose length disagrees with the tracked torso, as when it latches onto someone else', () => {
    expect(reasonOf(chainFor({ lengthScale: 0.3 }))).toBe('mismatch');
    expect(reasonOf(chainFor({ lengthScale: 2.5 }))).toBe('mismatch');
  });

  it('rejects a chain far from the tracked hip', () => {
    const spine = chainFor();
    spine.points = spine.points.map((p) => ({ ...p, x: p.x + 0.4 }));
    expect(reasonOf(spine)).toBe('mismatch');
  });

  it('rejects a chain lying across the tracked trunk', () => {
    const ctx = context({ leanDeg: 50 });
    expect(reasonOf(chainFor({ leanDeg: 140 }), ctx)).toBe('mismatch');
  });

  it('has no sign without a chest direction', () => {
    expect(read({}, { chest: null })).toEqual({ ok: false, reason: 'no_direction' });
  });
});
