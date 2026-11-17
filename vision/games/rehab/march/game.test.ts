import { describe, expect, it } from 'vitest';
import type { Side } from '../core/geometry';
import { createRng } from '../core/random';
import type { MockParams } from '../core/mockSkeleton';
import { DT, FPS, Rig } from '../testing/rig';
import marchConfig from './config.json';
import { MARCH_LEVELS, MARCH_TIMING, MarchGame, PatternGenerator, type Bar, type FootSample, type MarchEvent, type MarchLevel } from './game';
import { footDrift, footHeight, kneeRise } from './measure';

const LV = (id: string) => MARCH_LEVELS.find((l) => l.id === id)!;
const OPTS = { legFactor: { left: 1, right: 1 }, assist: false };

type Body = (t: number, game: MarchGame) => Partial<Omit<FootSample, 't'>>;

const still: FootSample = { t: 0, h: { left: 0, right: 0 }, knee: { left: 0, right: 0 }, drift: { left: 0, right: 0 }, lean: 0 };

/** Runs the game on a fake song clock, one sample per frame. */
function run(game: MarchGame, seconds: number, body: Body, from = 0): MarchEvent[] {
  const events: MarchEvent[] = [];
  for (let i = 1; i <= Math.round(seconds * FPS); i += 1) {
    const t = from + i * DT;
    const b = body(t, game);
    game.pushSample({ ...still, ...b, t, h: { ...still.h, ...b.h }, knee: { ...still.knee, ...b.knee }, drift: { ...still.drift, ...b.drift } });
    events.push(...game.update(t));
  }
  return events;
}

const judged = (events: MarchEvent[]) => events.filter((e): e is Extract<MarchEvent, { type: 'judged' }> => e.type === 'judged');

/** A smooth marching lift for one bar: up and down over 0.66 s, peaking `offset` s after arrival. */
function liftFor(bar: Bar, t: number, opts: { offset?: number; extra?: number; kneeRatio?: number } = {}) {
  const k = (t - (bar.arrival + (opts.offset ?? 0))) / 0.33;
  if (Math.abs(k) >= 1) return 0;
  return (bar.height + (opts.extra ?? 6)) * Math.cos((k * Math.PI) / 2);
}

/** The perfect stepper: each bar's own leg lifts, peaking on the beat, knee up. */
function stepper(opts: { offset?: number; extra?: number; kneeRatio?: number; drift?: number; legs?: Side[] } = {}): Body {
  return (t, game) => {
    const h = { left: 0, right: 0 };
    for (const bar of game.bars) {
      if (opts.legs && !opts.legs.includes(bar.leg)) continue;
      h[bar.leg] = Math.max(h[bar.leg], liftFor(bar, t, opts));
    }
    const kr = opts.kneeRatio ?? 0.9;
    return {
      h,
      knee: { left: h.left * kr, right: h.right * kr },
      drift: { left: h.left > 1 ? opts.drift ?? 0 : 0, right: h.right > 1 ? opts.drift ?? 0 : 0 },
    };
  };
}

/** A game with exactly the given bars and no scheduling. */
function withBars(level: MarchLevel, bars: Omit<Bar, 'id' | 'judged' | 'result' | 'timingError' | 'peakHeight'>[]): MarchGame {
  const game = new MarchGame(level, OPTS, marchConfig, { ...MARCH_TIMING, roundSeconds: 1 });
  game.bars = bars.map((b, i) => ({ ...b, id: i + 1, judged: false, result: null, timingError: null, peakHeight: 0 }));
  return game;
}

describe('foot measurements (mock skeleton through the tracker)', () => {
  const marchLandmarks = marchConfig.requiredLandmarks;

  function settle(rig: Rig, patch: Partial<MockParams>) {
    for (let i = 0; i < FPS; i += 1) rig.step(patch);
    return rig.healthyFrame!;
  }

  for (const lift of [10, 25, 45]) {
    it(`a ${lift}% march lift reads about ${lift}% foot height and a matching knee rise`, () => {
      const rig = new Rig(marchLandmarks);
      rig.lockBase();
      const f = settle(rig, { leftFootLift: lift });
      // The floor line is the average of heel and toe; the lowest point (the toe) sits 1% below it.
      expect(Math.abs(footHeight(f.pts, rig.base, 'left', f.scale) - lift)).toBeLessThan(1.5);
      expect(footHeight(f.pts, rig.base, 'right', f.scale)).toBeLessThan(1);
      expect(kneeRise(f.pts, rig.base, 'left', f.scale)).toBeGreaterThan(0.6 * lift);
    });
  }

  it('a heel kick lifts the foot but not the knee', () => {
    const rig = new Rig(marchLandmarks);
    rig.lockBase();
    const f = settle(rig, { leftFootLift: 25, heelKick: true });
    expect(footHeight(f.pts, rig.base, 'left', f.scale)).toBeGreaterThan(15);
    expect(kneeRise(f.pts, rig.base, 'left', f.scale)).toBeLessThan(2);
  });

  it('a sideways swing shows as drift in hip widths', () => {
    const rig = new Rig(marchLandmarks);
    rig.lockBase();
    expect(footDrift(settle(rig, { leftFootLift: 20 }).pts, rig.base, 'left')).toBeLessThan(0.2);
    const f = settle(rig, { leftFootLift: 20, leftFootSwing: 20 });
    expect(footDrift(f.pts, rig.base, 'left', f.scale)).toBeGreaterThan(marchConfig.maxDriftHipWidths);
  });
});

describe('patterns', () => {
  it('never puts more than 2 bars in a row on one leg', () => {
    for (const set of ['alternate', 'walking'] as const) {
      const gen = new PatternGenerator(set, createRng(7));
      let run = 0;
      let last = '';
      for (let i = 0; i < 500; i += 1) {
        const s = gen.next();
        if (s === '-') continue;
        run = s === last ? run + 1 : 1;
        last = s;
        expect(run).toBeLessThanOrEqual(2);
      }
    }
  });

  it('is repeatable from the seed', () => {
    const seq = (seed: number) => {
      const g = new PatternGenerator('walking', createRng(seed));
      return Array.from({ length: 40 }, () => g.next()).join('');
    };
    expect(seq(4242)).toBe(seq(4242));
    expect(seq(4242)).not.toBe(seq(1));
  });

  it('alternates left and right at L1 to L4, with bars on the beat at the level tempo', () => {
    for (const id of ['L1', 'L2', 'L3', 'L4']) {
      const lv = LV(id);
      const game = new MarchGame(lv, OPTS);
      run(game, 12, () => ({}));
      const bars = [...game.bars].sort((a, b) => a.arrival - b.arrival);
      for (let i = 1; i < bars.length; i += 1) {
        expect(bars[i].leg).not.toBe(bars[i - 1].leg);
        expect(bars[i].arrival - bars[i - 1].arrival).toBeCloseTo((lv.beatsPerBar * 60) / lv.bpm, 6);
      }
    }
  });

  it('editing levels.json changes tempo and heights with no code change', () => {
    const game = new MarchGame({ ...LV('L1'), bpm: 120, beatsPerBar: 1, heights: [33] }, OPTS);
    run(game, 6, () => ({}));
    const bars = [...game.bars].sort((a, b) => a.arrival - b.arrival);
    expect(bars[1].arrival - bars[0].arrival).toBeCloseTo(0.5, 6);
    expect(new Set(bars.map((b) => b.height))).toEqual(new Set([33]));
  });
});

describe('March to the Beat loopholes (fake clock)', () => {
  const L1 = LV('L1');
  const at = 4;
  const one = (leg: Side = 'left', height = 10, level = L1) => withBars(level, [{ leg, arrival: at, height }]);
  const bump = (leg: Side, peakAt: number, height: number, knee = 0.9) => (t: number) => {
    const k = (t - peakAt) / 0.33;
    const v = Math.abs(k) < 1 ? height * Math.cos((k * Math.PI) / 2) : 0;
    return { h: { left: 0, right: 0, [leg]: v }, knee: { left: 0, right: 0, [leg]: v * knee } };
  };

  it('a correct step on the beat is PERFECT', () => {
    const game = one();
    const e = judged(run(game, 6, bump('left', at, 16)));
    expect(e).toHaveLength(1);
    expect(e[0].bar.result).toBe('PERFECT');
    expect(game.score).toBe(100);
  });

  it('a step inside the window but off the beat is GOOD; outside the window it is a MISS', () => {
    expect(judged(run(one(), 6, bump('left', at + 0.3, 16)))[0].bar.result).toBe('GOOD');
    expect(judged(run(one(), 6, bump('left', at - 0.3, 16)))[0].bar.result).toBe('GOOD');
    // Window is 0.6 s at L1; a lift peaking 1 s early or late never reaches the bar height inside it.
    expect(judged(run(one(), 6, bump('left', at - 1.0, 16)))[0].bar.result).toBe('MISS');
    expect(judged(run(one(), 6, bump('left', at + 1.0, 16)))[0].bar.result).toBe('MISS');
  });

  it('a foot held up is not a real step', () => {
    const game = one();
    const e = judged(run(game, 6, () => ({ h: { left: 16, right: 0 }, knee: { left: 14, right: 0 } })));
    expect(e[0].bar.result).toBe('MISS');
    expect(e[0].cue).toBe('Put the foot down between steps');
  });

  it('a heel kick backward fails the knee rule', () => {
    const e = judged(run(one(), 6, bump('left', at, 16, 0.1)));
    expect(e[0].bar.result).toBe('MISS');
    expect(e[0].cue).toBe('Lift your knee up');
  });

  it('a leg swung sideways fails the lift-straight rule', () => {
    const game = one();
    const e = judged(
      run(game, 6, (t) => {
        const b = bump('left', at, 16)(t);
        return { ...b, drift: { left: b.h.left > 1 ? 0.8 : 0, right: 0 } };
      }),
    );
    expect(e[0].bar.result).toBe('MISS');
    expect(e[0].cue).toBe('Lift the knee straight up');
  });

  it('a jump with both feet is flagged, pauses, and the bar does not count', () => {
    const game = one();
    const events = run(game, 6, (t) => (Math.abs(t - at) < 0.3 ? { h: { left: 15, right: 12 }, knee: { left: 14, right: 11 } } : {}));
    expect(events.some((e) => e.type === 'safetyPause' && e.message === 'Keep one foot on the floor')).toBe(true);
    const e = judged(events);
    expect(e[0].bar.result).toBe('MISS');
    expect(game.metrics(6).jumps).toBe(1);
  });

  it('the wrong leg lifted is a miss and counts a wrong-leg lift', () => {
    const game = one('left');
    const events = run(game, 6, bump('right', at, 16));
    expect(judged(events)[0].bar.result).toBe('MISS');
    expect(events.some((e) => e.type === 'wrongLeg')).toBe(true);
    expect(game.metrics(6).wrongLegLifts).toBe(1);
    expect(judged(events)[0].cue).toBe('Left leg for blue');
  });

  it('the foot coming down between two close bars lets both count', () => {
    const game = withBars({ ...L1, window: 0.3 }, [
      { leg: 'left', arrival: 3.0, height: 10 },
      { leg: 'left', arrival: 3.7, height: 10 },
    ]);
    const lifts = (t: number) => {
      const a = bump('left', 3.0, 16)(t);
      const b = bump('left', 3.7, 16)(t);
      return a.h.left > b.h.left ? a : b;
    };
    const e = judged(run(game, 5, lifts));
    expect(e.map((x) => x.bar.result)).toEqual(['PERFECT', 'PERFECT']);
  });

  it('two close bars on one leg are never both cleared by one lift', () => {
    const game = withBars({ ...L1, window: 0.3 }, [
      { leg: 'left', arrival: 3.0, height: 10 },
      { leg: 'left', arrival: 3.4, height: 10 },
    ]);
    const e = judged(run(game, 5, bump('left', 3.2, 16)));
    expect(e).toHaveLength(2);
    expect(e.filter((x) => x.bar.result !== 'MISS')).toHaveLength(1);
  });

  it('the per-leg height factor changes the clearance needed', () => {
    const game = new MarchGame(L1, { legFactor: { left: 1.5, right: 1 }, assist: false });
    run(game, 10, () => ({}));
    const left = game.bars.filter((b) => b.leg === 'left');
    const right = game.bars.filter((b) => b.leg === 'right');
    expect(new Set(left.map((b) => b.height))).toEqual(new Set([15]));
    expect(new Set(right.map((b) => b.height))).toEqual(new Set([10]));
    // A 13% lift clears the right bars but not the left.
    const g3 = new MarchGame(L1, { legFactor: { left: 1.5, right: 1 }, assist: false });
    const res = judged(
      run(g3, 20, (t, g) => {
        const h = { left: 0, right: 0 };
        for (const bar of g.bars) {
          const k = (t - bar.arrival) / 0.33;
          if (Math.abs(k) < 1) h[bar.leg] = Math.max(h[bar.leg], 13 * Math.cos((k * Math.PI) / 2));
        }
        return { h, knee: { left: h.left * 0.9, right: h.right * 0.9 } };
      }),
    );
    expect(res.filter((x) => x.bar.leg === 'left').every((x) => x.bar.result === 'MISS')).toBe(true);
    expect(res.filter((x) => x.bar.leg === 'right').every((x) => x.bar.result === 'PERFECT')).toBe(true);
  });

  it('when the patient stops stepping, it pauses with "Take a rest" after 10 s', () => {
    const game = new MarchGame(L1, OPTS);
    const events = run(game, 9.5, () => ({}));
    expect(events.some((e) => e.type === 'safetyPause')).toBe(false);
    const more = run(game, 1, () => ({}), 9.5);
    expect(more.some((e) => e.type === 'safetyPause' && e.message === 'Take a rest')).toBe(true);
  });

  it('leaning over 10° stops a PERFECT; over 15° for 0.5 s pauses with "Stand tall"', () => {
    const game = one();
    const e = judged(run(game, 6, (t) => ({ ...bump('left', at, 16)(t), lean: 12 })));
    expect(e[0].bar.result).toBe('GOOD');
    const g2 = one();
    const events = run(g2, 6, () => ({ lean: 17 }));
    expect(events.some((x) => x.type === 'safetyPause' && x.message === 'Stand tall')).toBe(true);
  });

  it('a pause on the song clock resumes in sync: bars still arrive on the beat', () => {
    const game = new MarchGame(L1, OPTS);
    const step = stepper();
    run(game, 8, step);
    // Paused: the song clock (AudioContext) is suspended, so song time does not move and no samples come.
    game.notifyResumed(8);
    const events = run(game, 12, step, 8);
    const after = judged(events);
    expect(after.length).toBeGreaterThan(3);
    expect(after.every((x) => x.bar.result === 'PERFECT')).toBe(true);
    // No rest pause from the frozen gap.
    expect(events.some((x) => x.type === 'safetyPause')).toBe(false);
  });
});

describe('score, assist and stars', () => {
  it('PERFECT 100, GOOD 50; the combo multiplier goes up every 8 cleared bars, to x4', () => {
    const game = new MarchGame(LV('L3'), OPTS);
    const e = judged(run(game, 30, stepper()));
    const points = e.map((x) => x.points);
    expect(points.slice(0, 8).every((p) => p === 100)).toBe(true);
    expect(points.slice(8, 16).every((p) => p === 200)).toBe(true);
    expect(points.slice(16, 24).every((p) => p === 300)).toBe(true);
    expect(points.slice(24).every((p) => p === 400)).toBe(true);
  });

  it('assist mode lowers the BPM by 10 and heights by 5 after 60% misses in 10 bars', () => {
    const game = new MarchGame(LV('L4'), { legFactor: { left: 1, right: 1 }, assist: true });
    const events = run(game, 20, () => ({}));
    const assist = events.find((e) => e.type === 'assist');
    expect(assist).toMatchObject({ type: 'assist', bpm: 70 });
    run(game, 10, () => ({}), 20);
    const late = game.bars.filter((b) => !b.judged);
    expect(late.length).toBeGreaterThan(0);
    for (const b of late) expect([20, 30]).toContain(b.height);
    const off = new MarchGame(LV('L4'), OPTS);
    expect(run(off, 20, () => ({})).some((e) => e.type === 'assist')).toBe(false);
  });

  it('assist says from which song time the new tempo runs, and bars follow it from there', () => {
    const lv = LV('L4');
    const game = new MarchGame(lv, { legFactor: { left: 1, right: 1 }, assist: true });
    const events = run(game, 20, () => ({}));
    const assist = events.find((e): e is Extract<MarchEvent, { type: 'assist' }> => e.type === 'assist')!;
    expect(assist.fromSong).toBeGreaterThan(0);
    // On the old beat grid, so the music can switch exactly there.
    const oldBeat = 60 / lv.bpm;
    expect(Math.abs(assist.fromSong / oldBeat - Math.round(assist.fromSong / oldBeat))).toBeLessThan(1e-6);
    run(game, 10, () => ({}), 20);
    const arrivals = [...game.bars].map((b) => b.arrival).sort((a, b) => a - b);
    for (let i = 1; i < arrivals.length; i += 1) {
      const gap = arrivals[i] - arrivals[i - 1];
      expect(gap).toBeCloseTo(arrivals[i - 1] >= assist.fromSong - 1e-6 ? 60 / 70 : oldBeat, 6);
    }
  });

  it('stars: 50 / 70 / 90% cleared, 3 stars only with mean timing error under 150 ms', () => {
    const perfect = new MarchGame(LV('L2'), OPTS);
    run(perfect, 40, stepper());
    expect(perfect.stars()).toBe(3);
    const late = new MarchGame(LV('L2'), OPTS);
    run(late, 40, stepper({ offset: 0.2 }));
    expect(late.clearedPct()).toBe(100);
    expect(late.stars()).toBe(2);
  });

  it('symmetry index is 100 × (1 − |meanPeakL − meanPeakR| / max)', () => {
    const game = new MarchGame(LV('L1'), OPTS);
    run(game, 30, (t, g) => {
      const s = stepper()(t, g);
      return { ...s, h: { left: s.h!.left, right: s.h!.right * 0.8 }, knee: { left: s.knee!.left, right: s.knee!.right * 0.8 } };
    });
    const m = game.metrics(30);
    // The right leg lifts 0.8× as high as the left on every bar: symmetry 100 × (1 − 0.2) = 80.
    expect(m.meanPeakRight! / m.meanPeakLeft!).toBeCloseTo(0.8, 1);
    expect(m.symmetryIndex).toBe(80);
  });
});

describe('acceptance: mock skeleton through the tracker', () => {
  function play(level: MarchLevel, lift: (t: number, game: MarchGame) => Partial<MockParams>) {
    const rig = new Rig(marchConfig.requiredLandmarks);
    rig.lockBase();
    const game = new MarchGame(level, OPTS);
    const t0 = rig.t;
    const events: MarchEvent[] = [];
    while (!game.finished && rig.t - t0 < MARCH_TIMING.roundSeconds + 5) {
      const songT = rig.t + DT - t0;
      rig.step(lift(songT, game));
      const frame = rig.healthyFrame;
      if (!frame) continue;
      game.pushFrame(frame, rig.base, songT);
      events.push(...game.update(songT));
    }
    return { game, events };
  }

  const demo = (legs?: Side[]) => (t: number, game: MarchGame): Partial<MockParams> => {
    const lift = { left: 0, right: 0 };
    for (const bar of game.bars) {
      if (legs && !legs.includes(bar.leg)) continue;
      lift[bar.leg] = Math.max(lift[bar.leg], liftFor(bar, t));
    }
    return { leftFootLift: lift.left, rightFootLift: lift.right };
  };

  for (const id of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    it(`${id}: the scripted demo clears every bar; flat feet clear none`, () => {
      const good = play(LV(id), demo());
      expect(good.game.finished).toBe(true);
      expect(judged(good.events).length).toBeGreaterThan(20);
      expect(good.game.clearedPct()).toBe(100);
      const flat = play(LV(id), () => ({}));
      expect(flat.game.clearedPct()).toBe(0);
    });
  }

  it('blue bars are only cleared by the left leg and red bars only by the right leg', () => {
    const rightOnly = play(LV('L2'), (t, g) => {
      const lift = { left: 0, right: 0 };
      for (const bar of g.bars) lift.right = Math.max(lift.right, liftFor(bar, t));
      return { leftFootLift: 0, rightFootLift: lift.right };
    });
    const e = judged(rightOnly.events);
    expect(e.filter((x) => x.bar.leg === 'left').every((x) => x.bar.result === 'MISS')).toBe(true);
    expect(e.filter((x) => x.bar.leg === 'right').every((x) => x.bar.result !== 'MISS')).toBe(true);
  });
});
