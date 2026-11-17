import {
  angleFromVertical,
  dist,
  lateralSign,
  LM,
  mid,
  sideIdx,
  type ImageBounds,
  type P2,
  type Side,
} from '../core/geometry';
import { createRng } from '../core/random';
import type { BasePose, RehabFrame } from '../core/types';
import bubblesConfig from './config.json';
import levelsJson from './levels.json';
import rulesJson from './rules.json';

export type BubblesConfig = typeof bubblesConfig;
export type RuleId = keyof typeof rulesJson;
export type BubbleColour = 'blue' | 'red';
export type BubbleKind = 'normal' | 'gold' | 'distractor';
export type HandRole = Side | 'avoid';

export interface BubbleLevel {
  id: string;
  name: string;
  rules: RuleId[];
  ruleChangeSeconds: number | null;
  colourPhases: { until: number; colours: BubbleColour[] }[] | null;
  spawnEvery: number;
  lifetime: number;
  radius: number;
  speed: number;
  crossingFraction: number;
  goldEvery: number;
  distractorEvery: number;
  midlineHint: boolean;
  march: boolean;
}

export const BUBBLE_LEVELS = levelsJson.levels as unknown as BubbleLevel[];
export const RULES = rulesJson;

export interface Bubble {
  id: number;
  colour: BubbleColour;
  kind: BubbleKind;
  /** Image-space centre now. */
  x: number;
  y: number;
  radius: number;
  /** Rise speed, image units per second. */
  speed: number;
  /** Game-clock time of spawn. */
  bornAt: number;
  age: number;
  lifetime: number;
  /** Hand that had to pop it under the rule at spawn (null for distractors). */
  handAtSpawn: Side | null;
  crossingAtSpawn: boolean;
  popped: boolean;
  missed: boolean;
  removed: boolean;
  /** Game time of the end (pop, miss, distractor burst), for fade-out drawing. */
  endedAt: number | null;
  shakeUntil: number;
  lastWrongAt: number;
}

export interface HandPoint {
  side: Side;
  p: P2;
  fromWrist: boolean;
}

export type BubbleEvent =
  | { type: 'spawn'; bubble: Bubble }
  | { type: 'pop'; bubble: Bubble; hand: Side; points: number; reaction: number; crossing: boolean }
  | { type: 'wrongHand'; bubble: Bubble; hand: Side }
  | { type: 'distractor'; bubble: Bubble; hand: Side }
  | { type: 'missed'; bubble: Bubble }
  | { type: 'ruleAnnounce'; next: RuleId }
  | { type: 'ruleChange'; rule: RuleId }
  | { type: 'finished' };

export interface BubbleOptions {
  seated: boolean;
  foamPad: boolean;
  seed?: number;
}

export interface BubbleMetrics {
  level: string;
  seated: boolean;
  foamPad: boolean;
  correctPops: number;
  correctHandPct: number;
  wrongHandTouches: number;
  distractorTouches: number;
  missed: number;
  reactionMeanLeft: number | null;
  reactionMeanRight: number | null;
  reactionMedianLeft: number | null;
  reactionMedianRight: number | null;
  crossingPops: number;
  crossingSuccessPct: number | null;
  farthestCrossLeftPct: number;
  farthestCrossRightPct: number;
  trunkLeanEvents: number;
  marchCadence: number | null;
  swayPct: number | null;
  score: number;
}

/** Fingertip when visible, else the wrist, else null. */
export function handPoint(frame: RehabFrame, side: Side, cfg: BubblesConfig = bubblesConfig): HandPoint | null {
  const i = sideIdx(side);
  if ((frame.vis[i.index] ?? 0) >= cfg.fingertipMinVisibility) return { side, p: frame.pts[i.index], fromWrist: false };
  if ((frame.vis[i.wrist] ?? 0) >= cfg.wristMinVisibility) return { side, p: frame.pts[i.wrist], fromWrist: true };
  return null;
}

/** Average x of mid-shoulder and mid-hip. */
export function midlineX(pts: readonly P2[]): number {
  return (mid(pts[LM.lShoulder], pts[LM.rShoulder]).x + mid(pts[LM.lHip], pts[LM.rHip]).x) / 2;
}

/** Which hand a bubble needs under a rule, or 'avoid'. */
export function roleFor(rule: RuleId, colour: BubbleColour, kind: BubbleKind): HandRole {
  if (kind === 'distractor') return 'avoid';
  return RULES[rule][colour] as HandRole;
}

/** Signed distance of x past the midline toward `side`'s own side (negative = across the body). */
export function towardSide(pts: readonly P2[], side: Side, x: number, midX: number): number {
  return (x - midX) * lateralSign(pts, side);
}

export interface ReachZone {
  centre: P2;
  rx: number;
  ry: number;
  shoulders: Record<Side, P2>;
  arm: number;
}

export function reachZone(frame: RehabFrame, base: BasePose, cfg: BubblesConfig = bubblesConfig): ReachZone {
  const p = frame.pts;
  const arm = base.armLength * frame.scale;
  const sm = mid(p[LM.lShoulder], p[LM.rShoulder]);
  const top = sm.y - cfg.reach.above * arm;
  const bottom = sm.y + cfg.reach.below * arm;
  return {
    centre: { x: midlineX(p), y: (top + bottom) / 2 },
    rx: cfg.reach.horizontal * arm,
    ry: (bottom - top) / 2,
    shoulders: { left: p[LM.lShoulder], right: p[LM.rShoulder] },
    arm,
  };
}

export function inEllipse(z: ReachZone, q: P2): boolean {
  const dx = (q.x - z.centre.x) / z.rx;
  const dy = (q.y - z.centre.y) / z.ry;
  return dx * dx + dy * dy <= 1;
}

/** A bubble of `radius` at `q` sits wholly inside `v`, and still does half way up its rise. */
export function onScreen(v: ImageBounds, q: P2, radius: number, riseHalf: number): boolean {
  return (
    q.x - radius >= v.minX &&
    q.x + radius <= v.maxX &&
    q.y + radius <= v.maxY &&
    q.y - riseHalf - radius >= v.minY
  );
}

/** A spawn the given hand can reach: at spawn and half way through its rise. */
export function reachable(z: ReachZone, hand: Side, q: P2, riseHalf: number, cfg: BubblesConfig = bubblesConfig): boolean {
  const max = cfg.reach.maxFromShoulder * z.arm;
  const s = z.shoulders[hand];
  return dist(s, q) <= max && dist(s, { x: q.x, y: q.y - riseHalf }) <= max;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Cross-Over Bubbles: spawning inside reach, pop judging by the rule at the
 * moment of the touch, rule rotation, level 5 marching gate, score and metrics.
 */
export class CrossOverBubblesGame {
  readonly level: BubbleLevel;
  readonly options: BubbleOptions;
  readonly cfg: BubblesConfig;
  readonly roundSeconds: number;

  bubbles: Bubble[] = [];
  hands: Record<Side, HandPoint | null> = { left: null, right: null };
  midX = 0;
  zone: ReachZone | null = null;
  rule: RuleId;
  ruleAnnounce: RuleId | null = null;
  elapsed = 0;
  /** Bubble clock: stops while level 5 marching has stopped. */
  bubbleClock = 0;
  score = 0;
  streak = 0;
  marching = true;
  leaning = false;
  trunkLean = 0;
  cue: { text: string; until: number } | null = null;
  finished = false;
  /**
   * The part of the picture the screen shows. When set, a bubble only spawns where it is
   * fully on screen, at birth and half way up its rise (the portrait screen is narrower
   * than the patient's reach). Null keeps the whole reach zone.
   */
  visible: ImageBounds | null = null;

  private rng: () => number;
  private nextId = 1;
  private spawnTimer = 0;
  private ruleIndex = 0;
  private lastT: number | null = null;
  private leanTime = 0;
  private leanEvents = 0;
  private correctPops = 0;
  private wrongTouches = 0;
  private distractorTouches = 0;
  private missed = 0;
  private targetsSpawned = 0;
  private crossingTargets = 0;
  private crossingPops = 0;
  private crossingTargetsPopped = 0;
  private farthest: Record<Side, number> = { left: 0, right: 0 };
  private reactions: Record<Side, number[]> = { left: [], right: [] };
  private lastLift: { side: Side; t: number } | null = null;
  private liftArmed: Record<Side, boolean> = { left: true, right: true };
  private lifts = 0;
  private marchStartedAt: number | null = null;
  private swaySamples: number[] = [];

  constructor(level: BubbleLevel, options: BubbleOptions, cfg: BubblesConfig = bubblesConfig, roundSeconds = levelsJson.roundSeconds) {
    this.level = level;
    this.options = options;
    this.cfg = cfg;
    this.roundSeconds = roundSeconds;
    this.rng = createRng(options.seed ?? cfg.seed);
    this.rule = level.rules[0];
    // First bubble arrives quickly.
    this.spawnTimer = level.spawnEvery * 0.6;
  }

  /** Colours spawned right now. */
  colours(): BubbleColour[] {
    const phases = this.level.colourPhases;
    if (!phases) return ['blue', 'red'];
    return (phases.find((p) => this.elapsed < p.until) ?? phases[phases.length - 1]).colours;
  }

  /** Short rule line for the card. */
  ruleText(): string {
    const cols = this.colours();
    if (cols.length === 1) {
      const role = RULES[this.rule][cols[0]];
      return `Pop ${cols[0]} with your ${String(role).toUpperCase()} hand`;
    }
    return RULES[this.rule].text;
  }

  canUseHoverMenu(): boolean {
    const z = this.zone;
    if (!z) return true;
    const shoulderY = (z.shoulders.left.y + z.shoulders.right.y) / 2;
    return (['left', 'right'] as Side[]).every((s) => !this.hands[s] || this.hands[s]!.p.y > shoulderY);
  }

  isFinished(): boolean {
    return this.finished;
  }

  /**
   * Tracking lost or the Pause button. Spawns, the round timer, rule changes and
   * bubble ages stop: the first frame after `resume` advances nothing.
   */
  pause(): void {
    this.lastT = null;
  }

  resume(): void {
    // Nothing to restore: `pause` already made the next frame a fresh start.
  }

  private say(text: string, t: number, seconds = 2): void {
    this.cue = { text, until: t + seconds };
  }

  update(frame: RehabFrame, base: BasePose): BubbleEvent[] {
    const events: BubbleEvent[] = [];
    const t = frame.t;
    const dt = this.lastT === null ? 0 : Math.min(0.2, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.finished) return events;
    if (this.cue && t > this.cue.until) this.cue = null;

    this.elapsed += dt;
    this.hands = { left: handPoint(frame, 'left', this.cfg), right: handPoint(frame, 'right', this.cfg) };
    this.midX = midlineX(frame.pts);
    this.zone = reachZone(frame, base, this.cfg);
    if (!this.hands.left && !this.hands.right) this.say('Show your hands', t, 0.5);
    if (this.options.foamPad && base.shoulderWidth > 0) {
      this.swaySamples.push((mid(frame.pts[LM.lHip], frame.pts[LM.rHip]).x / (base.shoulderWidth * frame.scale)) * 100);
    }

    this.updateLean(frame, dt, t);
    this.updateRules(events);
    if (this.level.march) this.updateMarch(frame, base, t);

    const clockRuns = !this.level.march || this.marching;
    const bdt = clockRuns ? dt : 0;
    this.bubbleClock += bdt;

    // Spawn.
    if (clockRuns) {
      this.spawnTimer += dt;
      const live = this.bubbles.filter((b) => !b.removed && b.endedAt === null).length;
      if (this.spawnTimer >= this.level.spawnEvery && live < this.cfg.maxBubbles) {
        this.spawnTimer = 0;
        const b = this.spawn(frame);
        if (b) events.push({ type: 'spawn', bubble: b });
      }
    }

    // Move, age, judge touches.
    for (const b of this.bubbles) {
      if (b.removed) continue;
      if (b.endedAt !== null) {
        if (this.bubbleClock - b.endedAt > this.cfg.fadeSeconds) b.removed = true;
        continue;
      }
      b.age += bdt;
      b.y -= b.speed * bdt;
      if (b.age >= b.lifetime) {
        b.endedAt = this.bubbleClock;
        if (roleFor(this.rule, b.colour, b.kind) !== 'avoid') {
          b.missed = true;
          this.missed += 1;
          events.push({ type: 'missed', bubble: b });
        }
        continue;
      }
      this.judgeTouch(b, t, events, base, frame);
    }
    this.bubbles = this.bubbles.filter((b) => !b.removed);

    if (this.elapsed >= this.roundSeconds) {
      this.finished = true;
      events.push({ type: 'finished' });
    }
    return events;
  }

  private judgeTouch(b: Bubble, t: number, events: BubbleEvent[], base: BasePose, frame: RehabFrame): void {
    const handR = this.cfg.handRadius * (this.zone?.arm ?? base.armLength);
    const touching = (['left', 'right'] as Side[]).filter((s) => {
      const h = this.hands[s];
      return h !== null && dist(h.p, b) < b.radius + handR;
    });
    if (!touching.length) return;
    const role = roleFor(this.rule, b.colour, b.kind);
    if (role === 'avoid') {
      b.endedAt = this.bubbleClock;
      this.distractorTouches += 1;
      this.score = Math.max(0, this.score - this.cfg.score.distractorPenalty);
      events.push({ type: 'distractor', bubble: b, hand: touching[0] });
      return;
    }
    if (touching.includes(role)) {
      b.popped = true;
      b.endedAt = this.bubbleClock;
      const reaction = b.age;
      const sw = base.shoulderWidth * frame.scale;
      const past = -towardSide(frame.pts, role, b.x, this.midX);
      const crossing = past >= this.cfg.crossingMinShoulderWidths * sw;
      const sc = this.cfg.score;
      const mult = Math.min(sc.comboMax, 1 + Math.floor(this.streak / sc.comboEvery));
      const bonus = reaction < sc.fastSeconds && !this.leaning ? sc.fastBonus : 0;
      const points = (sc.pop * (b.kind === 'gold' ? sc.goldMultiplier : 1) + bonus) * mult;
      this.score += points;
      this.streak += 1;
      this.correctPops += 1;
      this.reactions[role].push(reaction);
      if (b.crossingAtSpawn) this.crossingTargetsPopped += 1;
      if (crossing) {
        this.crossingPops += 1;
        if (sw > 0) this.farthest[role] = Math.max(this.farthest[role], (100 * past) / sw);
      }
      events.push({ type: 'pop', bubble: b, hand: role, points, reaction, crossing });
      return;
    }
    // Only the wrong hand is touching.
    if (t - b.lastWrongAt >= this.cfg.wrongHandRepeatSeconds) {
      b.lastWrongAt = t;
      b.shakeUntil = t + 0.4;
      this.wrongTouches += 1;
      this.streak = 0;
      events.push({ type: 'wrongHand', bubble: b, hand: touching[0] });
    }
  }

  private updateRules(events: BubbleEvent[]): void {
    const every = this.level.ruleChangeSeconds;
    if (!every || this.level.rules.length < 2) return;
    const idx = Math.floor(this.elapsed / every);
    const next = this.level.rules[(idx + 1) % this.level.rules.length];
    const untilChange = (idx + 1) * every - this.elapsed;
    const announcing = untilChange <= this.cfg.ruleAnnounceSeconds;
    if (announcing && this.ruleAnnounce !== next) {
      this.ruleAnnounce = next;
      events.push({ type: 'ruleAnnounce', next });
    } else if (!announcing) this.ruleAnnounce = null;
    if (idx !== this.ruleIndex) {
      this.ruleIndex = idx;
      this.rule = this.level.rules[idx % this.level.rules.length];
      this.ruleAnnounce = null;
      events.push({ type: 'ruleChange', rule: this.rule });
    }
  }

  private updateLean(frame: RehabFrame, dt: number, t: number): void {
    const p = frame.pts;
    this.trunkLean = angleFromVertical(mid(p[LM.lHip], p[LM.rHip]), mid(p[LM.lShoulder], p[LM.rShoulder]), true);
    const cfg = this.cfg.trunkLean;
    if (!cfg.enabled) {
      this.leaning = false;
      return;
    }
    this.leanTime = this.trunkLean > cfg.borderline ? this.leanTime + dt : 0;
    const was = this.leaning;
    this.leaning = this.leanTime >= cfg.cueAfterSeconds;
    if (this.leaning) {
      if (!was) this.leanEvents += 1;
      this.say('Reach with your arm, keep your body still', t, 1);
    }
  }

  private updateMarch(frame: RehabFrame, base: BasePose, t: number): void {
    const cfg = this.cfg.march;
    if (this.marchStartedAt === null) this.marchStartedAt = t;
    const leg = base.legLength * frame.scale;
    for (const s of ['left', 'right'] as Side[]) {
      const i = sideIdx(s);
      if ((frame.vis[i.knee] ?? 0) < 0.5) continue;
      const rise = ((base.kneeY[s] - frame.pts[i.knee].y) / leg) * 100;
      if (this.liftArmed[s] && rise >= cfg.liftPct) {
        this.liftArmed[s] = false;
        const alternates = !this.lastLift || this.lastLift.side !== s || t - this.lastLift.t > cfg.gapSeconds;
        if (alternates) {
          this.lastLift = { side: s, t };
          this.lifts += 1;
        }
      } else if (!this.liftArmed[s] && rise < cfg.lowerPct) this.liftArmed[s] = true;
    }
    const since = t - (this.lastLift?.t ?? this.marchStartedAt);
    this.marching = since <= cfg.gapSeconds;
    if (!this.marching) this.say('Keep marching', t, 0.5);
  }

  private spawn(frame: RehabFrame): Bubble | null {
    const z = this.zone;
    if (!z) return null;
    const lv = this.level;
    const rng = this.rng;
    const radius = lv.radius * z.arm;
    const speed = lv.speed * z.arm;
    const riseHalf = (speed * lv.lifetime) / 2;
    const sw = Math.abs(z.shoulders.left.x - z.shoulders.right.x);

    let kind: BubbleKind = 'normal';
    if (lv.distractorEvery > 0 && rng() < 1 / lv.distractorEvery) kind = 'distractor';
    else if (lv.goldEvery > 0 && rng() < 1 / lv.goldEvery) kind = 'gold';

    const cols = this.colours();
    let colour: BubbleColour = cols[Math.floor(rng() * cols.length) % cols.length];
    let role = roleFor(this.rule, colour, kind);
    if (kind === 'gold' && role === 'avoid') {
      colour = colour === 'blue' ? 'red' : 'blue';
      role = roleFor(this.rule, colour, kind);
      if (role === 'avoid') kind = 'normal';
    }
    const hand: Side | null = role === 'avoid' ? null : role;
    const crossing = hand !== null && (kind === 'gold' || rng() < lv.crossingFraction);

    for (let tries = 0; tries < this.cfg.reach.spawnTries; tries += 1) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng());
      const q = { x: z.centre.x + Math.cos(a) * r * z.rx, y: z.centre.y + Math.sin(a) * r * z.ry };
      if (!inEllipse(z, q)) continue;
      if (this.visible && !onScreen(this.visible, q, radius, riseHalf)) continue;
      if (this.bubbles.some((b) => !b.removed && b.endedAt === null && dist(b, q) < b.radius + radius)) continue;
      if (hand) {
        const toward = towardSide(frame.pts, hand, q.x, this.midX);
        if (crossing ? toward > -this.cfg.crossingMinShoulderWidths * sw : toward < this.cfg.sameSideMinShoulderWidths * sw) continue;
        if (!reachable(z, hand, q, riseHalf, this.cfg)) continue;
      } else if (!reachable(z, 'left', q, riseHalf, this.cfg) && !reachable(z, 'right', q, riseHalf, this.cfg)) continue;

      const b: Bubble = {
        id: this.nextId++,
        colour,
        kind,
        x: q.x,
        y: q.y,
        radius,
        speed,
        bornAt: this.bubbleClock,
        age: 0,
        lifetime: lv.lifetime,
        handAtSpawn: hand,
        crossingAtSpawn: crossing,
        popped: false,
        missed: false,
        removed: false,
        endedAt: null,
        shakeUntil: 0,
        lastWrongAt: -Infinity,
      };
      if (hand) {
        this.targetsSpawned += 1;
        if (crossing) this.crossingTargets += 1;
      }
      this.bubbles.push(b);
      return b;
    }
    return null;
  }

  correctPct(): number {
    return this.targetsSpawned > 0 ? Math.min(100, (100 * this.correctPops) / this.targetsSpawned) : 0;
  }

  stars(): number {
    const pct = this.correctPct();
    const s = this.cfg.stars;
    const wrongPct = this.correctPops > 0 ? (100 * this.wrongTouches) / this.correctPops : 100;
    if (pct >= s.three && wrongPct < s.threeMaxWrongPct) return 3;
    if (pct >= s.two) return 2;
    if (pct >= s.one) return 1;
    return 0;
  }

  metrics(): BubbleMetrics {
    const r1 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
    const touches = this.correctPops + this.wrongTouches;
    let sway: number | null = null;
    if (this.options.foamPad && this.swaySamples.length > 1) {
      const m = mean(this.swaySamples)!;
      sway = Math.round(Math.sqrt(mean(this.swaySamples.map((v) => (v - m) ** 2))!) * 10) / 10;
    }
    const marchMinutes = this.marchStartedAt !== null ? this.elapsed / 60 : 0;
    return {
      level: this.level.id,
      seated: this.options.seated,
      foamPad: this.options.foamPad,
      correctPops: this.correctPops,
      correctHandPct: touches ? Math.round((100 * this.correctPops) / touches) : 0,
      wrongHandTouches: this.wrongTouches,
      distractorTouches: this.distractorTouches,
      missed: this.missed,
      reactionMeanLeft: r1(mean(this.reactions.left)),
      reactionMeanRight: r1(mean(this.reactions.right)),
      reactionMedianLeft: r1(median(this.reactions.left)),
      reactionMedianRight: r1(median(this.reactions.right)),
      crossingPops: this.crossingPops,
      crossingSuccessPct: this.crossingTargets ? Math.round((100 * this.crossingTargetsPopped) / this.crossingTargets) : null,
      farthestCrossLeftPct: Math.round(this.farthest.left),
      farthestCrossRightPct: Math.round(this.farthest.right),
      trunkLeanEvents: this.leanEvents,
      marchCadence: this.level.march && marchMinutes > 0 ? Math.round(this.lifts / marchMinutes) : null,
      swayPct: sway,
      score: this.score,
    };
  }
}

/** Required landmarks for a level and options. */
export function bubbleLandmarks(level: BubbleLevel, seated: boolean, cfg: BubblesConfig = bubblesConfig): number[] {
  const ids = [...cfg.requiredLandmarks];
  if (level.march) ids.push(...cfg.marchExtraLandmarks);
  if (!seated && level.march) ids.push(...cfg.standingExtraLandmarks);
  return ids;
}
