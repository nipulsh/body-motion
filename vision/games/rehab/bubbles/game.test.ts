import { describe, expect, it } from 'vitest';
import type { PoseResult } from '../../../types';
import { dist, LM, type P2, type Side } from '../core/geometry';
import { MOCK_ASPECT, mockPose, type MockParams } from '../core/mockSkeleton';
import { DT, FPS, Rig } from '../testing/rig';
import bubblesConfig from './config.json';
import {
  BUBBLE_LEVELS,
  bubbleLandmarks,
  CrossOverBubblesGame,
  handPoint,
  midlineX,
  roleFor,
  towardSide,
  type Bubble,
  type BubbleColour,
  type BubbleEvent,
  type BubbleKind,
  type BubbleLevel,
} from './game';
import rulesJson from './rules.json';

const L = (id: string) => BUBBLE_LEVELS.find((l) => l.id === id)!;
/** A level with no automatic spawns, so a test places its own bubbles. */
const quiet = (id: string): BubbleLevel => ({ ...L(id), spawnEvery: 1e9 });

interface Play {
  events: BubbleEvent[];
  cues: Set<string>;
}

function setup(level: BubbleLevel, params: Partial<MockParams> = {}) {
  const rig = new Rig(bubbleLandmarks(level, false), { params });
  rig.lockBase();
  const game = new CrossOverBubblesGame(level, { seated: false, foamPad: false });
  return { rig, game };
}

function drive(
  rig: Rig,
  game: CrossOverBubblesGame,
  seconds: number,
  profile: (t: number) => Partial<MockParams> = () => ({}),
  out?: Play,
  pose?: (p: PoseResult) => PoseResult,
): Play {
  const play = out ?? { events: [], cues: new Set<string>() };
  for (let i = 0; i < Math.round(seconds * FPS); i += 1) {
    const patch = profile(i * DT);
    if (pose) {
      rig.set(patch);
      rig.step(undefined, pose(mockPose(rig.params, rig.t + DT)!));
    } else rig.step(patch);
    const frame = rig.healthyFrame;
    if (!frame) {
      game.pause();
      continue;
    }
    game.resume();
    play.events.push(...game.update(frame, rig.base));
    if (game.cue) play.cues.add(game.cue.text);
  }
  return play;
}

const of = <T extends BubbleEvent['type']>(p: Play, type: T) => p.events.filter((e): e is Extract<BubbleEvent, { type: T }> => e.type === type);

/** Puts a bubble straight onto the screen at an image point. */
function place(game: CrossOverBubblesGame, at: P2, colour: BubbleColour, kind: BubbleKind = 'normal', radius = 0.03): Bubble {
  const b: Bubble = {
    id: 1000 + game.bubbles.length,
    colour,
    kind,
    x: at.x,
    y: at.y,
    radius,
    speed: 0,
    bornAt: game.bubbleClock,
    age: 0,
    lifetime: 60,
    handAtSpawn: null,
    crossingAtSpawn: false,
    popped: false,
    missed: false,
    removed: false,
    endedAt: null,
    shakeUntil: 0,
    lastWrongAt: -Infinity,
  };
  game.bubbles.push(b);
  return b;
}

/** Normalized mock wrist target that puts the hand out to the side at shoulder height. */
const reachOut = (side: Side, across = false): P2 => {
  const x = 0.5 + ((side === 'left') !== across ? 1 : -1) * 0.1;
  return { x, y: 0.42 };
};

/** Moves a wrist, waits for the smoothing, and returns the hand point the game sees. */
function handAt(rig: Rig, game: CrossOverBubblesGame, side: Side, target: P2 | null, play?: Play): P2 {
  const key = side === 'left' ? 'leftWrist' : 'rightWrist';
  drive(rig, game, 0.6, () => ({ [key]: target }), play);
  return game.hands[side]!.p;
}

describe('hand and midline mapping', () => {
  it('uses the index fingertip, and the wrist when the fingertip is not visible', () => {
    const { rig, game } = setup(quiet('L2'));
    drive(rig, game, 0.3);
    expect(handPoint(rig.healthyFrame!, 'left')!.fromWrist).toBe(false);
    drive(rig, game, 0.3, () => ({ hideFingertips: true }));
    const h = handPoint(rig.healthyFrame!, 'left')!;
    expect(h.fromWrist).toBe(true);
    expect(dist(h.p, rig.healthyFrame!.pts[LM.lWrist])).toBeLessThan(1e-9);
  });

  it('midline is the average x of mid-shoulder and mid-hip and follows the body', () => {
    const { rig, game } = setup(quiet('L2'));
    drive(rig, game, 0.3);
    const p = rig.healthyFrame!.pts;
    const expected = ((p[LM.lShoulder].x + p[LM.rShoulder].x) / 2 + (p[LM.lHip].x + p[LM.rHip].x) / 2) / 2;
    expect(midlineX(p)).toBeCloseTo(expected, 9);
    const before = game.midX;
    drive(rig, game, 1.5, () => ({ bodyShiftX: 0.02 }));
    expect(game.midX - before).toBeCloseTo(0.02 * MOCK_ASPECT, 2);
  });

  it("the patient's left is positive toward the left hand's own side", () => {
    const { rig, game } = setup(quiet('L2'));
    drive(rig, game, 0.3);
    const p = rig.healthyFrame!.pts;
    const mx = midlineX(p);
    expect(towardSide(p, 'left', p[LM.lShoulder].x, mx)).toBeGreaterThan(0);
    expect(towardSide(p, 'right', p[LM.lShoulder].x, mx)).toBeLessThan(0);
  });
});

describe('Cross-Over Bubbles loopholes', () => {
  it('both hands near one bubble: only the correct hand pops it', () => {
    const { rig, game } = setup(quiet('L2'));
    const spot = { x: 0.5, y: 0.45 };
    drive(rig, game, 0.8, () => ({ leftWrist: spot, rightWrist: spot }));
    const blue = place(game, game.hands.left!.p, 'blue', 'normal', 0.05);
    const play = drive(rig, game, 0.3, () => ({ leftWrist: spot, rightWrist: spot }));
    const pops = of(play, 'pop');
    expect(pops).toHaveLength(1);
    expect(pops[0].hand).toBe('left');
    expect(blue.popped).toBe(true);
    expect(of(play, 'wrongHand')).toHaveLength(0);
  });

  it('wrong hand first: no pop, counted once per second, then the right hand pops it', () => {
    const { rig, game } = setup(quiet('L2'));
    const p = handAt(rig, game, 'right', reachOut('right'));
    const blue = place(game, p, 'blue', 'normal', 0.04);
    const play = drive(rig, game, 0.8, () => ({ rightWrist: reachOut('right') }));
    expect(blue.popped).toBe(false);
    expect(of(play, 'wrongHand')).toHaveLength(1);
    // Still touching at 1 s: one more count (0.8 + 1.0 = 1.8 s in all).
    drive(rig, game, 1.0, () => ({ rightWrist: reachOut('right') }), play);
    expect(of(play, 'wrongHand')).toHaveLength(2);
    expect(game.streak).toBe(0);
    // Now the left hand reaches across and pops it.
    drive(rig, game, 0.2, () => ({ rightWrist: null }), play);
    blue.x = game.hands.left!.p.x;
    blue.y = game.hands.left!.p.y;
    drive(rig, game, 0.2, () => ({}), play);
    expect(blue.popped).toBe(true);
    expect(game.metrics().wrongHandTouches).toBe(2);
  });

  it('fingertip not visible: the wrist pops the bubble', () => {
    const { rig, game } = setup(quiet('L2'));
    drive(rig, game, 0.6, () => ({ hideFingertips: true }));
    const wrist = rig.healthyFrame!.pts[LM.lWrist];
    place(game, wrist, 'blue', 'normal', 0.03);
    const play = drive(rig, game, 0.2, () => ({ hideFingertips: true }));
    expect(of(play, 'pop')).toHaveLength(1);
  });

  it('both hands not visible: no pops, and the cue is "Show your hands"', () => {
    const { rig, game } = setup(quiet('L2'));
    drive(rig, game, 0.3);
    const left = game.hands.left!.p;
    const right = game.hands.right!.p;
    const b1 = place(game, left, 'blue', 'normal', 0.05);
    const b2 = place(game, right, 'red', 'normal', 0.05);
    const hide = (p: PoseResult): PoseResult => ({
      ...p,
      landmarks: p.landmarks.map((l, i) => ([LM.lWrist, LM.rWrist, LM.lIndex, LM.rIndex, 17, 18, 21, 22].includes(i) ? { ...l, visibility: 0.1 } : l)),
    });
    const play = drive(rig, game, 1, () => ({}), undefined, hide);
    expect(rig.status!.healthy).toBe(true);
    expect(of(play, 'pop')).toHaveLength(0);
    expect(b1.popped || b2.popped).toBe(false);
    expect(play.cues).toContain('Show your hands');
  });

  it('a bubble is popped once: keeping the hand on it does not count again', () => {
    const { rig, game } = setup(quiet('L2'));
    const p = handAt(rig, game, 'left', reachOut('left'));
    place(game, p, 'blue', 'normal', 0.05);
    const play = drive(rig, game, 2, () => ({ leftWrist: reachOut('left') }));
    expect(of(play, 'pop')).toHaveLength(1);
    expect(game.metrics().correctPops).toBe(1);
  });

  it('reaction time runs from the spawn', () => {
    const { rig, game } = setup(quiet('L2'));
    drive(rig, game, 0.5);
    // Spawn out of reach of the resting hand, then reach for it 1.5 s later.
    const p = handAt(rig, game, 'left', reachOut('left'));
    drive(rig, game, 0.6, () => ({ leftWrist: null }));
    const b = place(game, p, 'blue', 'normal', 0.02);
    const play = drive(rig, game, 1.5, () => ({ leftWrist: null }));
    expect(b.popped).toBe(false);
    drive(rig, game, 1, () => ({ leftWrist: reachOut('left') }), play);
    const pop = of(play, 'pop')[0];
    expect(pop).toBeDefined();
    expect(pop.reaction).toBeGreaterThan(1.5);
    expect(pop.reaction).toBeCloseTo(b.age, 6);
  });

  it('a rule change while a bubble is on screen: judged by the rule at the moment of the touch', () => {
    const { rig, game } = setup(quiet('L4'));
    expect(game.rule).toBe('R1');
    drive(rig, game, 29);
    const p = handAt(rig, game, 'right', reachOut('right'));
    drive(rig, game, 0.4, () => ({ rightWrist: null }));
    // Blue under R1 is the left hand's. It stays blue when the rule swaps.
    const blue = place(game, p, 'blue', 'normal', 0.03);
    const play = drive(rig, game, 1.2, () => ({ rightWrist: null }));
    expect(game.rule).toBe('R2');
    expect(of(play, 'ruleChange')).toHaveLength(1);
    expect(blue.colour).toBe('blue');
    drive(rig, game, 0.8, () => ({ rightWrist: reachOut('right') }), play);
    expect(blue.popped).toBe(true);
    expect(of(play, 'pop')[0].hand).toBe('right');
  });

  it('announces a rule change 3 s ahead', () => {
    const { rig, game } = setup(quiet('L4'));
    const play = drive(rig, game, 27.5);
    expect(of(play, 'ruleAnnounce')).toHaveLength(1);
    expect(of(play, 'ruleAnnounce')[0].next).toBe('R2');
    expect(of(play, 'ruleChange')).toHaveLength(0);
  });

  it('tracking lost: spawns, timers and bubble ages pause, then continue', () => {
    const { rig, game } = setup(L('L2'));
    drive(rig, game, 3);
    const elapsed = game.elapsed;
    const ages = game.bubbles.map((b) => b.age);
    const spawned = game.bubbles.length;
    drive(rig, game, 5, () => ({ tracking: false }));
    expect(game.elapsed).toBe(elapsed);
    drive(rig, game, 0.3, () => ({ tracking: true }));
    // Only the frames since tracking came back count, not the 5 s gap.
    expect(game.elapsed - elapsed).toBeLessThan(0.35);
    game.bubbles.slice(0, ages.length).forEach((b, i) => expect(b.age - ages[i]).toBeLessThan(0.35));
    expect(game.bubbles.length).toBeLessThanOrEqual(spawned + 1);
  });

  it('level 5: when marching stops, spawning pauses and the cue is "Keep marching"', () => {
    const { rig, game } = setup(L('L5'));
    const march = (t: number): Partial<MockParams> => {
      const phase = (t % 1.2) / 1.2;
      return {
        leftFootLift: phase < 0.5 ? Math.sin(phase * 2 * Math.PI) * 16 : 0,
        rightFootLift: phase >= 0.5 ? Math.sin((phase - 0.5) * 2 * Math.PI) * 16 : 0,
      };
    };
    const play = drive(rig, game, 10, march);
    expect(game.marching).toBe(true);
    expect(of(play, 'spawn').length).toBeGreaterThan(3);
    const still = drive(rig, game, 8, () => ({ leftFootLift: 0, rightFootLift: 0 }));
    expect(game.marching).toBe(false);
    expect(still.cues).toContain('Keep marching');
    // Nothing spawns once the 2.5 s gap has passed.
    const late = drive(rig, game, 4, () => ({ leftFootLift: 0, rightFootLift: 0 }));
    expect(of(late, 'spawn')).toHaveLength(0);
    const again = drive(rig, game, 6, march);
    expect(of(again, 'spawn').length).toBeGreaterThan(0);
  });

  it('a second person walking in never pops anything', () => {
    const { rig, game } = setup(quiet('L2'), { secondPerson: true });
    // Bubbles where the second person's hands would be (far right of the picture).
    const other = mockPose({ ...rig.params }, 3.5)!;
    const ow = { x: other.landmarks[LM.lIndex].x * MOCK_ASPECT, y: other.landmarks[LM.lIndex].y };
    const b = place(game, ow, 'blue', 'normal', 0.06);
    const play = drive(rig, game, 8);
    expect(b.popped).toBe(false);
    expect(of(play, 'pop')).toHaveLength(0);
  });
});

describe('spawning and reach', () => {
  for (const id of ['L2', 'L3', 'L4', 'L5']) {
    it(`${id}: every target spawns inside reach of the hand that must pop it, crossing ones across the midline`, () => {
      const { rig, game } = setup({ ...L(id), march: false });
      const spawns = of(drive(rig, game, 90), 'spawn').map((e) => e.bubble);
      expect(spawns.length).toBeGreaterThan(20);
      const base = rig.base;
      const frame = rig.healthyFrame!;
      const arm = base.armLength * frame.scale;
      const sw = base.shoulderWidth * frame.scale;
      const shoulders = { left: frame.pts[LM.lShoulder], right: frame.pts[LM.rShoulder] };
      const mx = midlineX(frame.pts);
      let crossing = 0;
      for (const b of spawns) {
        if (!b.handAtSpawn) continue;
        const start = { x: b.x, y: b.y + b.speed * b.age };
        expect(dist(shoulders[b.handAtSpawn], start)).toBeLessThanOrEqual(bubblesConfig.reach.maxFromShoulder * arm * 1.02);
        if (b.crossingAtSpawn) {
          crossing += 1;
          expect(-towardSide(frame.pts, b.handAtSpawn, start.x, mx)).toBeGreaterThanOrEqual(bubblesConfig.crossingMinShoulderWidths * sw * 0.9);
        }
      }
      if (L(id).crossingFraction > 0) expect(crossing).toBeGreaterThan(5);
      else expect(crossing).toBe(0);
    });
  }

  it('L1 spawns blue only for the first 90 s, then red only', () => {
    const { rig, game } = setup(L('L1'));
    const first = of(drive(rig, game, 90), 'spawn').map((e) => e.bubble.colour);
    drive(rig, game, 0.5);
    const second = of(drive(rig, game, 60), 'spawn').map((e) => e.bubble.colour);
    expect(new Set(first)).toEqual(new Set(['blue']));
    expect(new Set(second)).toEqual(new Set(['red']));
  });

  it('gold bubbles only from L3, always crossing; distractors only at L4 and L5', () => {
    for (const id of ['L1', 'L2', 'L3', 'L4']) {
      const { rig, game } = setup(L(id));
      const spawns = of(drive(rig, game, 120), 'spawn').map((e) => e.bubble);
      const gold = spawns.filter((b) => b.kind === 'gold');
      const spiky = spawns.filter((b) => b.kind === 'distractor');
      if (id === 'L1' || id === 'L2') expect(gold.length + spiky.length).toBe(0);
      if (id === 'L3') {
        expect(gold.length).toBeGreaterThan(0);
        expect(spiky).toHaveLength(0);
      }
      if (id === 'L4') expect(spiky.length).toBeGreaterThan(0);
      for (const g of gold) expect(g.crossingAtSpawn).toBe(true);
    }
  });

  it('editing levels.json changes the game: spawn rate and lifetime', () => {
    const { rig, game } = setup({ ...L('L2'), spawnEvery: 1.0, lifetime: 2 });
    const play = drive(rig, game, 30);
    expect(of(play, 'spawn').length).toBeGreaterThanOrEqual(15);
    expect(of(play, 'missed').length).toBeGreaterThan(5);
  });

  it('rules.json drives which hand pops which colour', () => {
    expect(roleFor('R1', 'blue', 'normal')).toBe('left');
    expect(roleFor('R2', 'blue', 'normal')).toBe('right');
    expect(roleFor('R3', 'red', 'normal')).toBe('avoid');
    expect(roleFor('R4', 'blue', 'normal')).toBe('avoid');
    expect(roleFor('R5', 'red', 'normal')).toBe('left');
    expect(roleFor('R6', 'blue', 'normal')).toBe('right');
    expect(roleFor('R1', 'blue', 'distractor')).toBe('avoid');
    expect(Object.keys(rulesJson)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
  });
});

describe('score, compensation and stars', () => {
  it('10 per pop, +5 under 1.5 s, combo x2 after 5 in a row, a distractor costs 5', () => {
    const { rig, game } = setup(quiet('L2'));
    const p = handAt(rig, game, 'left', reachOut('left'));
    const points: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      place(game, p, 'blue', 'normal', 0.04);
      const play = drive(rig, game, 0.2, () => ({ leftWrist: reachOut('left') }));
      points.push(...of(play, 'pop').map((e) => e.points));
    }
    expect(points).toEqual([15, 15, 15, 15, 15, 30]);
    const before = game.score;
    place(game, p, 'red', 'distractor', 0.04);
    drive(rig, game, 0.2, () => ({ leftWrist: reachOut('left') }));
    expect(game.score).toBe(before - 5);
  });

  /** Tilts the upper body sideways about the mid-hip (lateral lean toward the patient's left). */
  const leanSideways = (deg: number) => (pose: PoseResult): PoseResult => {
    const a = (deg * Math.PI) / 180;
    const lm = pose.landmarks;
    const hx = ((lm[LM.lHip].x + lm[LM.rHip].x) / 2) * MOCK_ASPECT;
    const hy = (lm[LM.lHip].y + lm[LM.rHip].y) / 2;
    return {
      ...pose,
      landmarks: lm.map((l, i) => {
        if (i > 22) return l;
        const dx = l.x * MOCK_ASPECT - hx;
        const dy = l.y - hy;
        return { ...l, x: (hx + dx * Math.cos(a) + dy * Math.sin(a)) / MOCK_ASPECT, y: hy - dx * Math.sin(a) + dy * Math.cos(a) };
      }),
    };
  };

  it('leaning the trunk sideways over 8° for 1 s cues "Reach with your arm…" and removes the speed bonus', () => {
    const { rig, game } = setup(quiet('L2'));
    drive(rig, game, 0.5);
    const play = { events: [], cues: new Set<string>() } as Play;
    for (let deg = 1; deg <= 12; deg += 1) drive(rig, game, 0.05, () => ({}), play, leanSideways(deg));
    drive(rig, game, 1.5, () => ({}), play, leanSideways(12));
    expect(game.trunkLean).toBeGreaterThan(8);
    expect(play.cues).toContain('Reach with your arm, keep your body still');
    expect(game.leaning).toBe(true);
    place(game, game.hands.left!.p, 'blue', 'normal', 0.06);
    const pop = drive(rig, game, 0.2, () => ({}), undefined, leanSideways(12));
    expect(of(pop, 'pop')[0].points).toBe(10);
    expect(game.metrics().trunkLeanEvents).toBe(1);
  });

  it('stars: 50 / 70 / 90% of targets popped, 3 stars only with under 10% wrong-hand touches', () => {
    const g = new CrossOverBubblesGame(L('L2'), { seated: false, foamPad: false });
    const set = (spawned: number, pops: number, wrong: number) => {
      Object.assign(g as unknown as Record<string, number>, { targetsSpawned: spawned, correctPops: pops, wrongTouches: wrong });
      return g.stars();
    };
    expect(set(100, 49, 0)).toBe(0);
    expect(set(100, 50, 0)).toBe(1);
    expect(set(100, 70, 0)).toBe(2);
    expect(set(100, 90, 8)).toBe(3);
    expect(set(100, 90, 9)).toBe(2);
  });
});

describe('full rounds with the scripted demo', () => {
  /** The demo: each hand reaches for the oldest bubble it should pop; level 5 also marches. */
  function demo(game: CrossOverBubblesGame, t: number): Partial<MockParams> {
    const target = (side: Side) => {
      const mine = game.bubbles.filter((b) => b.endedAt === null && b.age > 1.0 && roleFor(game.rule, b.colour, b.kind) === side);
      mine.sort((a, b) => b.age - a.age);
      return mine[0] ? { x: mine[0].x / MOCK_ASPECT, y: mine[0].y } : null;
    };
    const out: Partial<MockParams> = { leftWrist: target('left'), rightWrist: target('right') };
    if (game.level.march) {
      const phase = (t % 1.2) / 1.2;
      out.leftFootLift = phase < 0.5 ? Math.sin(phase * 2 * Math.PI) * 16 : 0;
      out.rightFootLift = phase >= 0.5 ? Math.sin((phase - 0.5) * 2 * Math.PI) * 16 : 0;
    }
    return out;
  }

  for (const id of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    it(`${id}: a 3 minute round plays to the end with the scripted demo`, () => {
      const { rig, game } = setup(L(id));
      const play = drive(rig, game, 185, (t) => demo(game, t));
      expect(game.isFinished()).toBe(true);
      expect(of(play, 'finished')).toHaveLength(1);
      expect(game.correctPct()).toBeGreaterThanOrEqual(70);
      expect(game.metrics().wrongHandTouches).toBeLessThan(game.metrics().correctPops * 0.1 + 1);
    });
  }

  it('a right hand chasing every bubble never pops one the rule gives to the left hand', () => {
    const { rig, game } = setup(L('L3'));
    const play = drive(rig, game, 90, () => {
      const any = game.bubbles.filter((b) => b.endedAt === null && b.age > 0.5).sort((a, b) => b.age - a.age)[0];
      return { rightWrist: any ? { x: any.x / MOCK_ASPECT, y: any.y } : null, leftWrist: null };
    });
    const pops = of(play, 'pop');
    expect(pops.length).toBeGreaterThan(5);
    for (const pop of pops) {
      expect(pop.hand).toBe('right');
      expect(pop.bubble.colour).toBe('red');
    }
    expect(game.metrics().wrongHandTouches).toBeGreaterThan(5);
  });
});

describe('portrait screen: spawns stay where the patient can see them', () => {
  /** The slice of the 16:9 mock picture a narrow portrait screen shows. */
  function narrowWindow(rig: Rig, halfWidth: number) {
    const mx = midlineX(rig.healthyFrame!.pts);
    return { minX: mx - halfWidth, maxX: mx + halfWidth, minY: 0, maxY: 1 };
  }

  for (const id of ['L2', 'L3', 'L4']) {
    it(`${id}: every bubble spawns fully inside the visible picture, and still half way up its rise`, () => {
      const { rig, game } = setup({ ...L(id), march: false });
      drive(rig, game, 1);
      const visible = narrowWindow(rig, 0.18);
      game.visible = visible;
      const spawns = of(drive(rig, game, 120), 'spawn').map((e) => e.bubble);
      expect(spawns.length).toBeGreaterThan(10);
      for (const b of spawns) {
        // Bubbles keep rising after the event; rebuild where each one was born.
        const y = b.y + b.speed * b.age;
        expect(b.x - b.radius).toBeGreaterThanOrEqual(visible.minX - 1e-9);
        expect(b.x + b.radius).toBeLessThanOrEqual(visible.maxX + 1e-9);
        expect(y + b.radius).toBeLessThanOrEqual(visible.maxY + 1e-9);
        expect(y - (b.speed * b.lifetime) / 2 - b.radius).toBeGreaterThanOrEqual(visible.minY - 1e-9);
      }
      if (L(id).crossingFraction > 0) expect(spawns.filter((b) => b.crossingAtSpawn).length).toBeGreaterThan(3);
    });
  }

  it('spawns nothing rather than off screen when the window is too narrow for any bubble', () => {
    const { rig, game } = setup({ ...L('L2'), march: false });
    drive(rig, game, 1);
    game.visible = narrowWindow(rig, 0.001);
    expect(of(drive(rig, game, 30), 'spawn')).toHaveLength(0);
  });

  it('with no window set, spawning is as before (whole reach zone)', () => {
    const a = setup({ ...L('L3'), march: false });
    const b = setup({ ...L('L3'), march: false });
    b.game.visible = null;
    const sa = of(drive(a.rig, a.game, 60), 'spawn').map((e) => [e.bubble.x, e.bubble.colour]);
    const sb = of(drive(b.rig, b.game, 60), 'spawn').map((e) => [e.bubble.x, e.bubble.colour]);
    expect(sb).toEqual(sa);
  });
});
