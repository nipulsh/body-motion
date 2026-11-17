import { describe, expect, it } from 'vitest';
import { findRehabGame, REHAB_GAMES } from './registry';

const level = (gameId: string, options: Record<string, string | boolean>, i: number) => findRehabGame(gameId).levels(options)[i];

describe('game registry', () => {
  it('registers exactly the three Mirror Rehab games', () => {
    expect(REHAB_GAMES.map((g) => [g.id, g.name])).toEqual([
      ['squat', 'Fruit Catcher'],
      ['bubbles', 'Cross-Over Bubbles'],
      ['march', 'March to the Beat'],
    ]);
    expect(new Set(REHAB_GAMES.map((g) => g.id)).size).toBe(REHAB_GAMES.length);
  });

  it('every game has 5 levels, numbered 1 to 5, with an outline icon', () => {
    for (const g of REHAB_GAMES) {
      const opts = g.normalizeOptions ? g.normalizeOptions(g.defaultOptions) : g.defaultOptions;
      expect(g.levels(opts).map((l) => l.number)).toEqual([1, 2, 3, 4, 5]);
      expect(g.icon).toMatch(/^M/);
    }
    expect(findRehabGame('squat').levels({ view: 'side', style: 'standard' }).map((l) => l.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
  });

  it('declares the views the doc asks for', () => {
    expect(Object.fromEntries(REHAB_GAMES.map((g) => [g.id, g.requiredView]))).toEqual({ squat: 'either', bubbles: 'front', march: 'front' });
  });

  it('asks for Ready confirm only where the doc does: March always, Bubbles at level 5', () => {
    const squat = findRehabGame('squat');
    const bubbles = findRehabGame('bubbles');
    const march = findRehabGame('march');
    expect([0, 1, 2, 3, 4].map((i) => squat.requireReadyConfirm?.(level('squat', squat.defaultOptions, i), squat.defaultOptions) ?? false)).toEqual([false, false, false, false, false]);
    expect([0, 1, 2, 3, 4].map((i) => bubbles.requireReadyConfirm?.(level('bubbles', {}, i), {}) ?? false)).toEqual([false, false, false, false, true]);
    expect([0, 1, 2, 3, 4].map((i) => march.requireReadyConfirm?.(level('march', {}, i), {}) ?? false)).toEqual([true, true, true, true, true]);
  });

  it('keeps Fruit Catcher stars per view and level', () => {
    const squat = findRehabGame('squat');
    expect(squat.levelKey(level('squat', { view: 'front' }, 0), { view: 'front' })).toBe('front:F1');
    expect(squat.levelKey(level('squat', { view: 'side' }, 0), { view: 'side' })).toBe('side:S1');
  });

  it('disables side levels a squat style does not allow', () => {
    const squat = findRehabGame('squat');
    expect(squat.levels({ view: 'side', style: 'oaGentle' }).map((l) => Boolean(l.disabled))).toEqual([false, false, false, true, true]);
    expect(squat.levels({ view: 'side', style: 'boxSquat' }).map((l) => Boolean(l.disabled))).toEqual([true, true, true, false, true]);
    expect(squat.levels({ view: 'front', style: 'boxSquat' }).every((l) => !l.disabled)).toBe(true);
  });

  it('Bubbles: Seated drops the leg checks; level 5 adds knees (and ankles standing) for marching', () => {
    const b = findRehabGame('bubbles');
    expect(b.seatedFor?.({ seated: true })).toBe(true);
    expect(b.landmarksFor?.(level('bubbles', {}, 1), {})).toEqual([11, 12, 23, 24]);
    expect(b.landmarksFor?.(level('bubbles', {}, 4), {})).toEqual([11, 12, 23, 24, 25, 26, 27, 28]);
    expect(b.landmarksFor?.(level('bubbles', {}, 4), { seated: true })).toEqual([11, 12, 23, 24, 25, 26]);
  });

  it('falls back to the first game for an unknown id', () => {
    expect(findRehabGame('nope').id).toBe('squat');
  });
});
