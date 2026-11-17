import type { BasePose, FormState, RehabFrame } from '../core/types';
import squatConfig from './config.json';
import levelsJson from './levels.json';
import {
  applyStyle,
  evaluateForm,
  FAULT_CUES,
  graded,
  styleRanges,
  type FaultId,
  type FormEval,
  type SquatLevel,
  type SquatStyleId,
  type SquatView,
} from './form';
import { measureSquat, SpeedMeter, type SquatMeasures } from './math';

export type RepState = 'READY' | 'LOWERING' | 'IN_ZONE' | 'RISING' | 'AT_TOP' | 'SPILLING' | 'PAUSED';
export type SquatPhase = 'active' | 'rest' | 'finished';

export type SquatEvent =
  | { type: 'fruitCollected'; index: number }
  | { type: 'fruitReturned'; count: number }
  | { type: 'spill'; count: number }
  | { type: 'emptyFruit'; index: number }
  | { type: 'repCounted'; points: number }
  | { type: 'setComplete'; set: number }
  | { type: 'restDone' }
  | { type: 'finished' };

export interface SquatCue {
  text: string;
  tone: 'good' | 'caution' | 'info';
  until: number;
}

export interface SquatMetrics {
  view: SquatView;
  level: string;
  style: SquatStyleId | null;
  repsDone: number;
  spilledReps: number;
  fruitCollected: number;
  averageDepth: number;
  bestDepth: number;
  holdTimeAchieved: number;
  formPct: number;
  faults: Partial<Record<FaultId, number>>;
  sessionSeconds: number;
}

export interface SquatOptions {
  view: SquatView;
  style: SquatStyleId;
}

/**
 * Fruit Catcher rep state machine, sets, rest, score, stars and metrics.
 * Pure logic: feed smoothed frames in time order with the session base.
 */
export class FruitCatcherGame {
  readonly level: SquatLevel;
  readonly view: SquatView;
  readonly style: SquatStyleId;
  readonly zone: [number, number];

  state: RepState = 'READY';
  phase: SquatPhase = 'active';
  /** Fruit in the basket, each with the form it was collected with. */
  basket: FormState[] = [];
  emptied = 0;
  aborted = false;
  set = 1;
  attempts = 0;
  repsDone = 0;
  spilledReps = 0;
  score = 0;
  restUntil = 0;
  measures: SquatMeasures | null = null;
  form: FormEval | null = null;
  cue: SquatCue | null = null;

  private readonly cfg = squatConfig;
  private readonly lv = levelsJson;
  private pausedFrom: RepState | null = null;
  private confirmCounts = new Map<string, number>();
  private speed = new SpeedMeter(squatConfig.speedSmoothing);
  private lastT: number | null = null;
  private startT: number | null = null;
  private zoneTime = 0;
  private holdTime = 0;
  private collectTimer = 0;
  private incorrectRisingTime = 0;
  private topTime = 0;
  private risingTime = 0;
  private emptyTimer = 0;
  private bounceDir = 0;
  private bounceFlips = 0;
  private bounceRef = 0;
  private repDepth = 0;
  private repFaults = new Set<FaultId>();
  private depths: number[] = [];
  private holds: number[] = [];
  private fruitCollected = 0;
  private goodFrames = 0;
  private activeFrames = 0;
  private faults: Partial<Record<FaultId, number>> = {};

  constructor(level: SquatLevel, options: SquatOptions) {
    this.view = options.view;
    this.style = options.style;
    this.level = applyStyle(level, options.view, options.style, this.lv);
    const tol = this.level.zoneTol;
    let hi = this.level.depth[1] + tol;
    if (this.view === 'front') hi = Math.min(hi, this.lv.maxHipDropPct);
    this.zone = [this.level.depth[0] - tol, hi];
  }

  get totalReps(): number {
    return this.lv.repsPerSet * this.lv.sets;
  }

  get repsThisSet(): number {
    return this.attempts - (this.set - 1) * this.lv.repsPerSet;
  }

  pause(): void {
    if (this.state === 'PAUSED') return;
    this.pausedFrom = this.state;
    this.state = 'PAUSED';
    this.lastT = null;
  }

  resume(): void {
    if (this.state !== 'PAUSED') return;
    this.state = this.pausedFrom ?? 'READY';
    this.pausedFrom = null;
    this.speed.reset();
    this.confirmCounts.clear();
  }

  isFinished(): boolean {
    return this.phase === 'finished';
  }

  canUseHoverMenu(): boolean {
    return (this.measures?.hipHeightPct ?? 100) >= this.lv.hoverMenuHipHeightPct || this.phase !== 'active';
  }

  /** Target hip height for the fruit line, percent of standing hip height. */
  targetHipHeightPct(): number {
    const mid = (this.zone[0] + this.zone[1]) / 2;
    if (this.view === 'front') return 100 - (this.level.depth[0] + this.level.depth[1]) / 2;
    // Side: thigh angle → hip height, with a typical shin angle for the style.
    const shin = styleRanges(this.level, this.style, this.lv).shin;
    const shinDeg = ((shin[0] + shin[1]) / 2) * (Math.PI / 180);
    const thighDeg = mid * (Math.PI / 180);
    return 100 * (0.49 * Math.cos(shinDeg) + 0.51 * Math.cos(Math.min(thighDeg, Math.PI / 2)));
  }

  inZone(depth: number): boolean {
    return depth >= this.zone[0] && depth <= this.zone[1];
  }

  private say(text: string, tone: SquatCue['tone'], t: number, seconds = 2): void {
    this.cue = { text, tone, until: t + seconds };
  }

  /** True once `cond` has held for the configured number of consecutive frames. */
  private confirm(key: string, cond: boolean, frames = 3): boolean {
    if (!cond) {
      this.confirmCounts.delete(key);
      return false;
    }
    const n = (this.confirmCounts.get(key) ?? 0) + 1;
    this.confirmCounts.set(key, n);
    return n >= frames;
  }

  private go(state: RepState): void {
    this.state = state;
    this.confirmCounts.clear();
  }

  private endAttempt(t: number, events: SquatEvent[], counted: boolean): void {
    this.attempts += 1;
    if (counted) {
      this.depths.push(this.repDepth);
      this.holds.push(this.holdTime);
    }
    for (const f of this.repFaults) this.faults[f] = (this.faults[f] ?? 0) + 1;
    this.repFaults.clear();
    this.basket = [];
    this.emptied = 0;
    this.aborted = false;
    this.repDepth = 0;
    this.go('READY');
    if (this.attempts >= this.totalReps) {
      this.phase = 'finished';
      events.push({ type: 'setComplete', set: this.set }, { type: 'finished' });
    } else if (this.attempts % this.lv.repsPerSet === 0) {
      events.push({ type: 'setComplete', set: this.set });
      this.phase = 'rest';
      this.restUntil = t + this.lv.restSeconds;
    }
  }

  update(frame: RehabFrame, base: BasePose): SquatEvent[] {
    const events: SquatEvent[] = [];
    const t = frame.t;
    if (this.startT === null) this.startT = t;
    const dt = this.lastT === null ? 0 : Math.min(0.2, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.state === 'PAUSED' || this.phase === 'finished') return events;

    const m = measureSquat(frame, base, this.view);
    this.measures = m;
    const lowerSpeed = this.speed.update(m.depth, t);
    const form = evaluateForm(m, { view: this.view, level: this.level, style: this.style, lowerSpeed, lowering: this.state === 'LOWERING' });
    this.form = form;
    if (this.cue && t > this.cue.until) this.cue = null;

    if (this.phase === 'rest') {
      if (t >= this.restUntil) {
        this.phase = 'active';
        this.set += 1;
        this.go('READY');
        events.push({ type: 'restDone' });
      }
      return events;
    }

    const active = this.state === 'LOWERING' || this.state === 'IN_ZONE' || this.state === 'RISING';
    if (active) {
      this.activeFrames += 1;
      if (form.overall === 'good') this.goodFrames += 1;
      if (form.worst?.fault && form.worst.state === 'incorrect') this.repFaults.add(form.worst.fault);
      this.repDepth = Math.max(this.repDepth, m.depth);
    }
    if (form.slowDown) this.say(FAULT_CUES.tooFast, 'caution', t);
    else if (active && form.worst && form.worst.state === 'incorrect' && form.worst.fault) {
      this.say(FAULT_CUES[form.worst.fault], 'caution', t, 1.2);
    }

    const lv = this.lv;
    switch (this.state) {
      case 'READY': {
        if (this.confirm('lower', m.hipDropPct > lv.startLoweringPct)) {
          this.go('LOWERING');
          this.repDepth = m.depth;
        }
        break;
      }
      case 'LOWERING': {
        if (this.confirm('enter', this.inZone(m.depth) && form.overall !== 'incorrect')) {
          this.go('IN_ZONE');
          this.zoneTime = 0;
          this.holdTime = 0;
          this.collectTimer = 0;
          this.bounceFlips = 0;
          this.bounceDir = 0;
          this.bounceRef = m.depth;
        } else if (this.confirm('stoodUp', m.hipDropPct < lv.startLoweringPct)) {
          this.go('READY');
          this.say('A little lower', 'info', t);
        }
        break;
      }
      case 'IN_ZONE': {
        this.zoneTime += dt;
        this.trackBounce(m.depth, t);
        const inside = this.inZone(m.depth);
        const formOk = form.overall !== 'incorrect';
        if (inside && formOk && this.basket.length < this.level.fruit) {
          this.collectTimer += dt;
          this.holdTime += dt;
          while (this.collectTimer >= lv.fruitIntervalSeconds && this.basket.length < this.level.fruit) {
            this.collectTimer -= lv.fruitIntervalSeconds;
            this.basket.push(form.overall);
            this.fruitCollected += 1;
            events.push({ type: 'fruitCollected', index: this.basket.length - 1 });
          }
        } else if (inside && formOk) {
          this.holdTime += dt;
        }
        if (this.zoneTime >= lv.maxZoneSeconds && this.basket.length < this.level.fruit) {
          while (this.basket.length < this.level.fruit) {
            this.basket.push(form.overall === 'incorrect' ? 'borderline' : form.overall);
            this.fruitCollected += 1;
            events.push({ type: 'fruitCollected', index: this.basket.length - 1 });
          }
          this.holdTime = Math.max(this.holdTime, this.level.hold);
          this.say('Stand up', 'info', t);
        }
        if (this.confirm('rise', m.depth < this.zone[0] - lv.riseAboveZone)) {
          const done = this.basket.length >= this.level.fruit && this.holdTime + 1e-6 >= this.level.hold;
          if (!done) {
            if (this.basket.length > 0) events.push({ type: 'fruitReturned', count: this.basket.length });
            this.fruitCollected -= this.basket.length;
            this.basket = [];
            this.aborted = true;
            this.say('Hold a little longer', 'caution', t);
          }
          this.go('RISING');
          this.incorrectRisingTime = 0;
          this.risingTime = 0;
          this.topTime = 0;
        }
        break;
      }
      case 'RISING':
      case 'SPILLING': {
        this.risingTime += dt;
        if (this.state === 'RISING' && !this.aborted && this.basket.length > 0) {
          this.incorrectRisingTime = form.overall === 'incorrect' ? this.incorrectRisingTime + dt : 0;
          if (this.incorrectRisingTime >= lv.spillIncorrectSeconds) {
            events.push({ type: 'spill', count: this.basket.length });
            this.basket = [];
            this.spilledReps += 1;
            this.go('SPILLING');
          }
        }
        if (this.risingTime > lv.standTallHintSeconds) this.say('Stand tall', 'info', t);
        this.topTime = m.hipHeightPct >= lv.topHipHeightPct ? this.topTime + dt : 0;
        if (this.topTime >= lv.topHoldSeconds) {
          if (this.state === 'SPILLING') this.endAttempt(t, events, false);
          else if (this.aborted) {
            this.aborted = false;
            this.go('READY');
          } else {
            this.go('AT_TOP');
            this.emptyTimer = 0;
            this.emptied = 0;
          }
        }
        break;
      }
      case 'AT_TOP': {
        const heel = graded(m.heelLift, this.cfg.heelLift.good, this.cfg.heelLift.borderline, this.level.strict, this.cfg);
        if (heel === 'incorrect') {
          this.say(FAULT_CUES.heelLift, 'caution', t, 1);
          this.repFaults.add('heelLift');
          break;
        }
        this.emptyTimer += dt;
        const per = lv.emptySeconds / Math.max(1, this.basket.length);
        while (this.emptied < this.basket.length && this.emptyTimer >= per * (this.emptied + 1)) {
          events.push({ type: 'emptyFruit', index: this.emptied });
          this.emptied += 1;
        }
        if (this.emptied >= this.basket.length) {
          const mult = this.cfg.formMultiplier;
          const points = this.basket.reduce((sum, f) => sum + this.cfg.pointsPerFruit * mult[f], 0);
          this.score += points;
          this.repsDone += 1;
          events.push({ type: 'repCounted', points });
          this.endAttempt(t, events, true);
        }
        break;
      }
      default:
        break;
    }
    return events;
  }

  private trackBounce(depth: number, t: number): void {
    const step = depth - this.bounceRef;
    if (Math.abs(step) < this.cfg.bounceMinStep) return;
    const dir = Math.sign(step);
    if (this.bounceDir !== 0 && dir !== this.bounceDir) {
      this.bounceFlips += 1;
      if (this.bounceFlips > this.cfg.bounceMaxFlips) {
        this.say(FAULT_CUES.bounce, 'caution', t);
        this.repFaults.add('bounce');
        this.bounceFlips = 0;
      }
    }
    this.bounceDir = dir;
    this.bounceRef = depth;
  }

  formPct(): number {
    return this.activeFrames > 0 ? (100 * this.goodFrames) / this.activeFrames : 100;
  }

  stars(): number {
    const pct = (100 * this.repsDone) / Math.max(1, this.totalReps);
    const s = this.cfg.stars;
    if (pct >= s.three && this.formPct() >= s.threeFormPct) return 3;
    if (pct >= s.two) return 2;
    if (pct >= s.one) return 1;
    return 0;
  }

  metrics(now: number): SquatMetrics {
    const avg = this.depths.length ? this.depths.reduce((a, b) => a + b, 0) / this.depths.length : 0;
    const hold = this.holds.length ? this.holds.reduce((a, b) => a + b, 0) / this.holds.length : 0;
    return {
      view: this.view,
      level: this.level.id,
      style: this.view === 'side' ? this.style : null,
      repsDone: this.repsDone,
      spilledReps: this.spilledReps,
      fruitCollected: this.fruitCollected,
      averageDepth: Math.round(avg * 10) / 10,
      bestDepth: Math.round(Math.max(0, ...this.depths) * 10) / 10,
      holdTimeAchieved: Math.round(hold * 10) / 10,
      formPct: Math.round(this.formPct()),
      faults: { ...this.faults },
      sessionSeconds: Math.round(this.startT === null ? 0 : now - this.startT),
    };
  }
}
