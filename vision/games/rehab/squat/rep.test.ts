import { describe, expect, it } from 'vitest';
import { MOCK_BODY, type MockParams } from '../core/mockSkeleton';
import { DT, FPS, ramp, Rig } from '../testing/rig';
import squatConfig from './config.json';
import { squatLevels, styleRanges, type SquatLevel, type SquatStyleId, type SquatView } from './form';
import levelsJson from './levels.json';
import { FruitCatcherGame, type SquatEvent } from './rep';

const D = Math.PI / 180;

function level(view: SquatView, id: string): SquatLevel {
  return squatLevels(view).find((l) => l.id === id)!;
}

/** Mock params for a side-view squat with the given thigh, shin and back angles. */
function sideParams(thetaDeg: number, shinDeg: number, backDeg: number): Partial<MockParams> {
  const T = MOCK_BODY.thigh;
  const S = MOCK_BODY.shin;
  const L = T + S;
  const hipUp = S * Math.cos(shinDeg * D) + T * Math.cos(thetaDeg * D);
  const hipBack = T * Math.sin(thetaDeg * D) - S * Math.sin(shinDeg * D);
  const drop = L - hipUp;
  return { view: 'side', hipDropPct: (100 * drop) / L, hipBackRatio: drop > 1e-4 ? hipBack / drop : 0.45, trunkLeanDeg: backDeg };
}

interface Play {
  events: SquatEvent[];
  cues: Set<string>;
  pausedFrames: number;
}

/** Feeds frames like the engine: unhealthy tracking pauses the game, healthy frames update it. */
function drive(rig: Rig, game: FruitCatcherGame, seconds: number, profile: (t: number) => Partial<MockParams>, out?: Play): Play {
  const play = out ?? { events: [], cues: new Set<string>(), pausedFrames: 0 };
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i += 1) {
    rig.step(profile(i * DT));
    const frame = rig.healthyFrame;
    if (!frame) {
      game.pause();
      play.pausedFrames += 1;
      continue;
    }
    game.resume();
    play.events.push(...game.update(frame, rig.base));
    if (game.cue) play.cues.add(game.cue.text);
  }
  return play;
}

const count = (p: Play, type: SquatEvent['type']) => p.events.filter((e) => e.type === type).length;

/** Timings of one well-paced rep for a level. */
function repTimes(lv: SquatLevel) {
  const down = (lv.tempoDown ?? 1.5) * 1.25;
  const hold = Math.max(lv.fruit * levelsJson.fruitIntervalSeconds, lv.hold) + 0.6;
  const up = (lv.tempoUp ?? 1.5) * 1.1;
  const top = levelsJson.emptySeconds + 1.2;
  return { down, hold, up, top, total: 1 + down + hold + up + top };
}

/** 0 → 1 → 0 progress of one rep through a squat. */
function repProgress(lv: SquatLevel, t: number): number {
  const r = repTimes(lv);
  return ramp(
    [
      [0, 0],
      [1, 0],
      [1 + r.down, 1],
      [1 + r.down + r.hold, 1],
      [1 + r.down + r.hold + r.up, 0],
    ],
    t % r.total,
  );
}

function frontRep(lv: SquatLevel, extra: (t: number, p: number) => Partial<MockParams> = () => ({})) {
  const target = (lv.depth[0] + lv.depth[1]) / 2;
  return (t: number): Partial<MockParams> => {
    const p = repProgress(lv, t);
    return { view: 'front', hipDropPct: target * p, trunkLeanDeg: 0, kneeCaveDeg: 0, heelLiftPct: 0, hipBackRatio: 0.45, ...extra(t, p) };
  };
}

function sideRep(lv: SquatLevel, style: SquatStyleId) {
  const target = (lv.depth[0] + lv.depth[1]) / 2;
  const r = styleRanges(lv, style);
  return (t: number): Partial<MockParams> => {
    const p = repProgress(lv, t);
    return sideParams(target * p, ((r.shin[0] + r.shin[1]) / 2) * p, ((r.back[0] + r.back[1]) / 2) * p);
  };
}

function setup(view: SquatView, id: string, style: SquatStyleId = 'standard', lv?: SquatLevel) {
  const rig = new Rig(squatConfig.requiredLandmarks, { params: { view } });
  rig.lockBase();
  const game = new FruitCatcherGame(lv ?? level(view, id), { view, style });
  return { rig, game, lv: game.level };
}

describe('Fruit Catcher: a full good rep', () => {
  for (const id of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    it(`${id}: collects every fruit, empties the basket into the crate and counts the rep`, () => {
      const { rig, game, lv } = setup('front', id);
      const play = drive(rig, game, repTimes(lv).total, frontRep(lv));
      expect(count(play, 'fruitCollected')).toBe(lv.fruit);
      expect(count(play, 'emptyFruit')).toBe(lv.fruit);
      expect(count(play, 'repCounted')).toBe(1);
      expect(count(play, 'spill')).toBe(0);
      expect(game.repsDone).toBe(1);
      expect(game.score).toBe(lv.fruit * squatConfig.pointsPerFruit);
    });
  }

  for (const [id, style] of [
    ['S1', 'standard'],
    ['S2', 'standard'],
    ['S3', 'standard'],
    ['S4', 'standard'],
    ['S4', 'hipBias'],
    ['S4', 'boxSquat'],
    ['S5', 'kneeBias'],
    ['S3', 'oaGentle'],
  ] as [string, SquatStyleId][]) {
    it(`${id} ${style} (side view): a good rep counts`, () => {
      const { rig, game, lv } = setup('side', id, style);
      const play = drive(rig, game, repTimes(lv).total, sideRep(lv, style));
      expect(count(play, 'repCounted')).toBe(1);
      expect(count(play, 'emptyFruit')).toBe(lv.fruit);
    });
  }
});

describe('Fruit Catcher loopholes', () => {
  it('early rise: the fruit go back to the branch and the rep does not count', () => {
    const { rig, game, lv } = setup('front', 'F3');
    const target = (lv.depth[0] + lv.depth[1]) / 2;
    // Down, one second in the zone (4 fruit need 2 s), back up, stand.
    const play = drive(rig, game, 9, (t) => ({ hipDropPct: ramp([[0, 0], [2.5, target], [3.5, target], [5.5, 0]], t) }));
    expect(count(play, 'fruitCollected')).toBeGreaterThan(0);
    expect(count(play, 'fruitReturned')).toBe(1);
    expect(play.cues).toContain('Hold a little longer');
    expect(count(play, 'repCounted')).toBe(0);
    expect(game.repsDone).toBe(0);
    expect(game.attempts).toBe(0);
    expect(game.basket).toHaveLength(0);
  });

  it('standing back up before the zone: "A little lower", no penalty', () => {
    const { rig, game } = setup('front', 'F3');
    const play = drive(rig, game, 6, (t) => ({ hipDropPct: ramp([[0, 0], [1.5, 15], [3, 0]], t) }));
    expect(play.cues).toContain('A little lower');
    expect(game.attempts).toBe(0);
    expect(game.state).toBe('READY');
  });

  it('bowing without a hip drop collects nothing', () => {
    const { rig, game } = setup('front', 'F3');
    const play = drive(rig, game, 6, (t) => ({ trunkLeanDeg: ramp([[0, 0], [2, 45]], t), hipDropPct: 0 }));
    expect(count(play, 'fruitCollected')).toBe(0);
    expect(game.state).toBe('READY');
  });

  it('a fast bounce in the zone says "Hold still" and logs the fault', () => {
    const { rig, game, lv } = setup('front', 'F3');
    const target = (lv.depth[0] + lv.depth[1]) / 2;
    const play = drive(rig, game, 6, (t) => ({
      hipDropPct: t < 2.5 ? (target * t) / 2.5 : target + 2.5 * Math.sin((t - 2.5) * 2 * Math.PI * 2.5),
    }));
    expect(play.cues).toContain('Hold still');
    drive(rig, game, 6, (t) => ({ hipDropPct: ramp([[0, target], [2, 0]], t) }), play);
    expect(game.metrics(rig.t).faults.bounce).toBeGreaterThanOrEqual(1);
  });

  it('knees caving on the way up spill the fruit: logged as spilled, no points', () => {
    const { rig, game, lv } = setup('front', 'F2');
    const r = repTimes(lv);
    const rising = (t: number) => t > 1 + r.down + r.hold + 0.3 && t < 1 + r.down + r.hold + r.up;
    const play = drive(rig, game, r.total, frontRep(lv, (t) => (rising(t) ? { kneeCaveDeg: 18 } : {})));
    expect(count(play, 'fruitCollected')).toBe(lv.fruit);
    expect(count(play, 'spill')).toBe(1);
    expect(count(play, 'repCounted')).toBe(0);
    expect(count(play, 'emptyFruit')).toBe(0);
    expect(game.spilledReps).toBe(1);
    expect(game.score).toBe(0);
    // Spilled reps count toward the set.
    expect(game.attempts).toBe(1);
  });

  it('heels lifted at the top stop the basket emptying, however long they are held', () => {
    const { rig, game, lv } = setup('front', 'F2');
    const r = repTimes(lv);
    const atTop = 1 + r.down + r.hold + r.up;
    // Heels up from just before the top for 8 s.
    const play = drive(rig, game, atTop + 8, frontRep(lv, (t) => (t > atTop - 0.2 ? { heelLiftPct: 8 } : {})));
    expect(count(play, 'fruitCollected')).toBe(lv.fruit);
    expect(count(play, 'emptyFruit')).toBe(0);
    expect(play.cues).toContain('Keep your heels down');
    // Heels down: the basket empties and the rep counts.
    drive(rig, game, 3, () => ({ heelLiftPct: 0, hipDropPct: 0 }), play);
    expect(count(play, 'emptyFruit')).toBe(lv.fruit);
    expect(count(play, 'repCounted')).toBe(1);
  });

  it('tracking lost mid rep pauses the game and resumes in the same state with the same fruit', () => {
    const { rig, game, lv } = setup('front', 'F3');
    const target = (lv.depth[0] + lv.depth[1]) / 2;
    const play = drive(rig, game, 4.2, (t) => ({ hipDropPct: ramp([[0, 0], [2.5, target]], t) }));
    expect(game.state).toBe('IN_ZONE');
    const fruit = game.basket.length;
    expect(fruit).toBeGreaterThan(0);
    drive(rig, game, 1.5, () => ({ tracking: false }), play);
    expect(game.state).toBe('PAUSED');
    expect(game.basket).toHaveLength(fruit);
    drive(rig, game, 0.3, () => ({ tracking: true, hipDropPct: target }), play);
    expect(game.state).toBe('IN_ZONE');
    drive(rig, game, 8, (t) => ({ hipDropPct: ramp([[0, target], [1.5, target], [3.5, 0]], t) }), play);
    expect(count(play, 'repCounted')).toBe(1);
  });

  it('a second person walking in is ignored: the rep still counts and nothing extra happens', () => {
    const { rig, game, lv } = setup('front', 'F2');
    rig.set({ secondPerson: true });
    const play = drive(rig, game, repTimes(lv).total * 2, frontRep(lv));
    expect(play.pausedFrames).toBeGreaterThan(0);
    expect(count(play, 'repCounted')).toBeGreaterThanOrEqual(1);
    expect(count(play, 'fruitReturned')).toBe(0);
    expect(count(play, 'spill')).toBe(0);
  });

  it('a patient who drifted closer still squats to the right depth (ratios, not pixels)', () => {
    const { rig, game, lv } = setup('front', 'F3');
    drive(rig, game, 3, (t) => ({ distanceScale: ramp([[0, 1], [2.5, 1.15]], t) }));
    const play = drive(rig, game, repTimes(lv).total, frontRep(lv, () => ({ distanceScale: 1.15 })));
    expect(count(play, 'repCounted')).toBe(1);
    const target = (lv.depth[0] + lv.depth[1]) / 2;
    expect(Math.abs(game.metrics(rig.t).bestDepth - target)).toBeLessThan(2);
  });

  it('menu hover is ignored while squatting and allowed standing tall', () => {
    const { rig, game, lv } = setup('front', 'F3');
    drive(rig, game, 1, () => ({ hipDropPct: 0 }));
    expect(game.canUseHoverMenu()).toBe(true);
    drive(rig, game, 3, (t) => ({ hipDropPct: ramp([[0, 0], [2.5, (lv.depth[0] + lv.depth[1]) / 2]], t) }));
    expect(game.canUseHoverMenu()).toBe(false);
  });

  it('lowering at more than twice the tempo says "Slow down"', () => {
    const { rig, game, lv } = setup('front', 'F4');
    const target = (lv.depth[0] + lv.depth[1]) / 2;
    const play = drive(rig, game, 3, (t) => ({ hipDropPct: ramp([[0, 0], [0.6, target]], t) }));
    expect(play.cues).toContain('Slow down');
  });

  it('after 8 s in the zone the rest of the fruit are collected and the cue is "Stand up"', () => {
    const { rig, game, lv } = setup('front', 'F3');
    const target = (lv.depth[0] + lv.depth[1]) / 2;
    const play = drive(rig, game, 3, (t) => ({ hipDropPct: ramp([[0, 0], [2.5, target]], t) }));
    expect(game.state).toBe('IN_ZONE');
    expect(count(play, 'fruitCollected')).toBeLessThan(lv.fruit);
    // Knees caving in the zone: form is incorrect, collecting pauses.
    drive(rig, game, 1, () => ({ hipDropPct: target, kneeCaveDeg: 15 }), play);
    expect(game.form?.overall).toBe('incorrect');
    const stalled = count(play, 'fruitCollected');
    drive(rig, game, 2, () => ({ hipDropPct: target, kneeCaveDeg: 15 }), play);
    expect(count(play, 'fruitCollected')).toBe(stalled);
    drive(rig, game, 6, () => ({ hipDropPct: target, kneeCaveDeg: 15 }), play);
    expect(play.cues).toContain('Stand up');
    expect(game.basket.length).toBe(lv.fruit);
  });
});

describe('Fruit Catcher sets, score and config', () => {
  it('plays a whole session: 2 sets of 8 with a 20 s rest, then finishes with 3 stars', () => {
    const { rig, game, lv } = setup('front', 'F2');
    const r = repTimes(lv);
    const play = drive(rig, game, 16 * r.total + levelsJson.restSeconds + 5, (t) => {
      // Stand through the rest, then keep repping.
      if (game.phase === 'rest') return { hipDropPct: 0 };
      return frontRep(lv)(t);
    });
    expect(count(play, 'setComplete')).toBe(2);
    expect(count(play, 'restDone')).toBe(1);
    expect(game.isFinished()).toBe(true);
    expect(game.repsDone).toBe(16);
    expect(game.stars()).toBe(3);
  });

  it('editing the level config changes depth, fruit and hold with no code change', () => {
    const custom: SquatLevel = { ...level('front', 'F2'), depth: [40, 50], fruit: 2, hold: 0 };
    const { rig, game, lv } = setup('front', 'F2', 'standard', custom);
    expect(game.zone).toEqual([36, 54]);
    const play = drive(rig, game, repTimes(lv).total, frontRep(lv));
    expect(count(play, 'fruitCollected')).toBe(2);
    expect(count(play, 'repCounted')).toBe(1);
    expect(game.metrics(rig.t).bestDepth).toBeGreaterThan(40);
  });

  it('stars: 1 at 50% of reps, 2 at 70%, 3 at 90% only with 80% good form', () => {
    const { game } = setup('front', 'F2');
    const total = game.totalReps;
    const at = (reps: number) => {
      game.repsDone = reps;
      return game.stars();
    };
    expect(at(Math.ceil(total * 0.49) - 1)).toBe(0);
    expect(at(Math.ceil(total * 0.5))).toBe(1);
    expect(at(Math.ceil(total * 0.7))).toBe(2);
    expect(at(total)).toBe(3);
  });
});
