import { describe, expect, it } from 'vitest';
import squatConfig from './config.json';
import {
  applyStyle,
  evaluateForm,
  expectedLowerSpeed,
  graded,
  inRange,
  speedCheck,
  squatLevels,
  styleAllowsLevel,
  styleRanges,
  tibiaCheck,
  tibiaRange,
  type SquatLevel,
} from './form';
import type { SquatMeasures } from './math';

const front = squatLevels('front');
const side = squatLevels('side');
const level = (view: 'front' | 'side', id: string): SquatLevel => (view === 'front' ? front : side).find((l) => l.id === id)!;

function measures(over: Partial<SquatMeasures> = {}): SquatMeasures {
  return {
    hipHeightPct: 60,
    hipDropPct: 40,
    depth: 40,
    side: { side: 'left', thighAngle: 90, backAngle: 35, shinAngle: 30 },
    tibia: { left: 4, right: 4 },
    toeOut: { left: 5, right: 5 },
    pelvisTilt: 0,
    lrDiff: 0,
    bowing: 0,
    heelLift: 0,
    ...over,
  };
}

describe('tibia ranges by toe-out (front view)', () => {
  const table: [number, [number, number]][] = [
    [5, [0, 8]],
    [15, [3, 12]],
    [25, [6, 18]],
    [35, [10, 24]],
  ];
  for (const [toe, range] of table) {
    it(`toe-out ${toe}° → correct ${range[0]}–${range[1]}°`, () => {
      expect(tibiaRange(toe)).toEqual(range);
      expect(tibiaCheck(range[0], toe, 0, false, true).state).toBe('good');
      expect(tibiaCheck(range[1], toe, 0, false, true).state).toBe('good');
      expect(tibiaCheck(range[1] + 2.9, toe, 0, false, true).state).toBe('borderline');
      expect(tibiaCheck(range[1] + 3.1, toe, 0, false, true).state).toBe('incorrect');
      expect(tibiaCheck(range[0] - 3.1, toe, 0, false, true)).toMatchObject({ state: 'incorrect', fault: 'kneeCave' });
    });
  }

  it('level 1 widens every range by 3°', () => {
    expect(tibiaRange(5, level('front', 'F1').tibiaWiden)).toEqual([-3, 11]);
  });

  it('strict levels halve the borderline band', () => {
    expect(tibiaCheck(8 + 2, 5, 0, true, true).state).toBe('incorrect');
    expect(tibiaCheck(8 + 1.4, 5, 0, true, true).state).toBe('borderline');
  });

  it('before depth only a caving knee is judged', () => {
    expect(tibiaCheck(15, 5, 0, false, false).state).toBe('good');
    expect(tibiaCheck(-5, 5, 0, false, false)).toMatchObject({ state: 'incorrect', fault: 'kneeCave' });
  });
});

describe('graded checks', () => {
  const cases: [keyof typeof squatConfig, number, number][] = [
    ['pelvis', 5, 8],
    ['lrDiff', 5, 10],
    ['bowing', 10, 15],
    ['heelLift', 3, 6],
  ];
  for (const [key, good, border] of cases) {
    it(`${key}: good under ${good}, borderline to ${border}, incorrect above`, () => {
      const c = squatConfig[key] as { good: number; borderline: number };
      expect([c.good, c.borderline]).toEqual([good, border]);
      expect(graded(good - 0.1, good, border, false)).toBe('good');
      expect(graded(border, good, border, false)).toBe('borderline');
      expect(graded(border + 0.1, good, border, false)).toBe('incorrect');
      // Strict: half the band.
      expect(graded(good + (border - good) * 0.6, good, border, true)).toBe('incorrect');
    });
  }
});

describe('back and shin ranges (side view)', () => {
  it('uses the gentle back range 0–40 at S1 to S3 for every style', () => {
    for (const id of ['S1', 'S2', 'S3']) {
      expect(styleRanges(level('side', id), 'hipBias').back).toEqual([0, 40]);
    }
  });

  it('uses the style ranges from S4', () => {
    const s4 = level('side', 'S4');
    expect(styleRanges(s4, 'standard')).toEqual({ back: [20, 50], shin: [20, 40] });
    expect(styleRanges(s4, 'kneeBias')).toEqual({ back: [15, 35], shin: [35, 50] });
    expect(styleRanges(s4, 'hipBias')).toEqual({ back: [40, 60], shin: [20, 35] });
    expect(styleRanges(s4, 'longFemur')).toEqual({ back: [45, 65], shin: [25, 40] });
    expect(styleRanges(s4, 'boxSquat')).toEqual({ back: [30, 55], shin: [5, 25] });
  });

  it('is borderline within 5° outside the range and incorrect beyond', () => {
    expect(inRange(55, [20, 50], 5)).toBe('borderline');
    expect(inRange(55.1, [20, 50], 5)).toBe('incorrect');
    expect(inRange(15, [20, 50], 5)).toBe('borderline');
  });
});

describe('styles', () => {
  it('OA gentle is S1 to S3 only, with depth capped at thigh angle 70', () => {
    expect(['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => styleAllowsLevel('oaGentle', id))).toEqual([true, true, true, false, false]);
    expect(applyStyle(level('side', 'S3'), 'side', 'oaGentle').depth).toEqual([60, 70]);
  });

  it('box squat is S4 only, with depth fixed at 85–100', () => {
    expect(['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => styleAllowsLevel('boxSquat', id))).toEqual([false, false, false, true, false]);
    expect(applyStyle(level('side', 'S4'), 'side', 'boxSquat').depth).toEqual([85, 100]);
  });

  it('styles do not change front levels', () => {
    expect(applyStyle(level('front', 'F3'), 'front', 'boxSquat').depth).toEqual([35, 45]);
  });
});

describe('lowering speed', () => {
  it('good at or slower than the tempo, borderline up to 25% faster, incorrect beyond, "Slow down" above twice', () => {
    const f2 = level('front', 'F2');
    const v = expectedLowerSpeed(f2);
    expect(v).toBeCloseTo(30 / 2, 6);
    expect(speedCheck(v, v, false).state).toBe('good');
    expect(speedCheck(v * 1.2, v, false).state).toBe('borderline');
    expect(speedCheck(v * 1.3, v, false).state).toBe('incorrect');
    expect(speedCheck(v * 1.9, v, false).slowDown).toBe(false);
    expect(speedCheck(v * 2.1, v, false).slowDown).toBe(true);
  });

  it('a free tempo judges against 1 s', () => {
    expect(expectedLowerSpeed(level('front', 'F1'))).toBeCloseTo(20, 6);
  });
});

describe('evaluateForm', () => {
  const ctx = (view: 'front' | 'side', id: string) => ({ view, level: level(view, id), style: 'standard' as const, lowerSpeed: 0, lowering: false });

  it('runs only the level checks for the view, and the overall state is the worst', () => {
    const e = evaluateForm(measures({ pelvisTilt: 6, bowing: 20 }), ctx('front', 'F2'));
    expect(e.checks.map((c) => c.id).sort()).toEqual(['pelvis', 'tibia']);
    expect(e.overall).toBe('borderline');
    expect(e.worst?.fault).toBe('pelvisTilt');
  });

  it('adds bowing at F3 and left-right difference at F4', () => {
    expect(evaluateForm(measures({ bowing: 20 }), ctx('front', 'F3')).overall).toBe('incorrect');
    expect(evaluateForm(measures({ lrDiff: 12 }), ctx('front', 'F3')).overall).toBe('good');
    expect(evaluateForm(measures({ lrDiff: 12 }), ctx('front', 'F4')).overall).toBe('incorrect');
  });

  it('turns the heel lift check on only at F5 and S5', () => {
    expect(evaluateForm(measures({ heelLift: 8 }), ctx('front', 'F4')).overall).toBe('good');
    expect(evaluateForm(measures({ heelLift: 8 }), ctx('front', 'F5')).overall).toBe('incorrect');
    expect(evaluateForm(measures({ heelLift: 8, depth: 100 }), ctx('side', 'S5')).overall).toBe('incorrect');
  });

  it('never judges tibia side on or back angle facing the mirror', () => {
    const sideIds = evaluateForm(measures({ tibia: { left: -20, right: -20 }, depth: 90 }), ctx('side', 'S4')).checks.map((c) => c.id);
    expect(sideIds).not.toContain('tibia');
    const frontIds = evaluateForm(measures(), ctx('front', 'F5')).checks.map((c) => c.id);
    expect(frontIds).not.toContain('back');
  });
});
