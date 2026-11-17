import type { Side } from '../core/geometry';
import { createRng, pick } from '../core/random';
import type { BasePose, RehabFrame } from '../core/types';
import marchConfig from './config.json';
import levelsJson from './levels.json';
import patternsJson from './patterns.json';
import { footDrift, footHeight, kneeRise, trunkLeanDeg } from './measure';

export type MarchConfig = typeof marchConfig;
export type Judgement = 'PERFECT' | 'GOOD' | 'MISS';

export interface MarchLevel {
  id: string;
  name: string;
  bpm: number;
  beatsPerBar: number;
  pattern: keyof typeof patternsJson.sets;
  heights: number[];
  window: number;
}

export const MARCH_LEVELS = levelsJson.levels as unknown as MarchLevel[];
export const MARCH_TIMING = { roundSeconds: levelsJson.roundSeconds, approachSeconds: levelsJson.approachSeconds, leadInBeats: levelsJson.leadInBeats };

export interface Bar {
  id: number;
  leg: Side;
  /** Song time the bar reaches the patient, on the beat. */
  arrival: number;
  /** Clearance needed, percent of leg length, after the per-leg factor. */
  height: number;
  judged: boolean;
  result: Judgement | null;
  timingError: number | null;
  peakHeight: number;
}

export interface FootSample {
  /** Song time the body was in this pose (camera latency already removed). */
  t: number;
  h: Record<Side, number>;
  knee: Record<Side, number>;
  drift: Record<Side, number>;
  lean: number;
}

export type MarchEvent =
  | { type: 'judged'; bar: Bar; cue: string | null; points: number }
  | { type: 'wrongLeg'; bar: Bar }
  | { type: 'safetyPause'; message: string }
  /** Tempo drops to `bpm` for bars arriving from song time `fromSong` on (a beat on the old grid). */
  | { type: 'assist'; bpm: number; fromSong: number }
  | { type: 'finished' };

export interface MarchOptions {
  legFactor: Record<Side, number>;
  assist: boolean;
  seed?: number;
  /** Song-clock BPM override (an mp3 with its own BPM). */
  bpm?: number;
}

export interface MarchMetrics {
  level: string;
  bpm: number;
  barsClearedPctLeft: number | null;
  barsClearedPctRight: number | null;
  meanPeakLeft: number | null;
  meanPeakRight: number | null;
  timingErrorMsLeft: number | null;
  timingErrorMsRight: number | null;
  timingBiasMsLeft: number | null;
  timingBiasMsRight: number | null;
  cadence: number;
  steps: number;
  symmetryIndex: number | null;
  timingSymmetry: number | null;
  jumps: number;
  wrongLegLifts: number;
  leanEvents: number;
  longestStreak: number;
  score: number;
  assistUsed: boolean;
}

/** Steps for a level's pattern, never more than `max` bars in a row on one leg. */
export class PatternGenerator {
  private queue: string[] = [];
  private run: { leg: string; n: number } = { leg: '', n: 0 };
  constructor(
    private readonly set: keyof typeof patternsJson.sets,
    private readonly rng: () => number,
    private readonly max = patternsJson.maxSameLegInARow,
  ) {}

  next(): 'L' | 'R' | '-' {
    if (!this.queue.length) this.queue.push(...pick(this.rng, patternsJson.sets[this.set]).steps);
    let step = this.queue.shift() as 'L' | 'R' | '-';
    if (step !== '-' && step === this.run.leg && this.run.n >= this.max) step = step === 'L' ? 'R' : 'L';
    if (step === '-') return step;
    this.run = step === this.run.leg ? { leg: step, n: this.run.n + 1 } : { leg: step, n: 1 };
    return step;
  }
}

function mean(v: number[]): number | null {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/**
 * March to the Beat: bar schedule, judging against foot samples on the song
 * clock, safety pauses, score and metrics. Feed samples with `pushFrame` and
 * call `update` with the current song time.
 */
export class MarchGame {
  readonly level: MarchLevel;
  readonly cfg: MarchConfig;
  readonly roundSeconds: number;
  readonly approachSeconds: number;
  bpm: number;
  bars: Bar[] = [];
  samples: FootSample[] = [];
  score = 0;
  streak = 0;
  finished = false;
  lastJudgement: { result: Judgement; leg: Side; at: number } | null = null;
  cue: { text: string; until: number } | null = null;
  /** Latest live foot heights for drawing. */
  live: FootSample | null = null;

  private readonly options: MarchOptions;
  private readonly rng: () => number;
  private readonly gen: PatternGenerator;
  private nextArrival: number;
  private nextId = 1;
  private heightDrop = 0;
  private assistUsed = false;
  private lastUsedPeak: Record<Side, number> = { left: -Infinity, right: -Infinity };
  private recent: Judgement[] = [];
  private bothUpSince: number | null = null;
  private jumpFlagUntil = -Infinity;
  /** Body times at which a jump was flagged. */
  private jumpAt: number[] = [];
  private jumps = 0;
  private wrongLeg = 0;
  private leanEvents = 0;
  private leanHighSince: number | null = null;
  private leaning = false;
  private liftArmed: Record<Side, boolean> = { left: true, right: true };
  private lastLiftAt: number;
  private steps = 0;
  private longest = 0;
  private perLeg: Record<Side, { bars: number; cleared: number; peaks: number[]; errors: number[] }> = {
    left: { bars: 0, cleared: 0, peaks: [], errors: [] },
    right: { bars: 0, cleared: 0, peaks: [], errors: [] },
  };

  constructor(level: MarchLevel, options: MarchOptions, cfg: MarchConfig = marchConfig, timing = MARCH_TIMING) {
    this.level = level;
    this.cfg = cfg;
    this.options = options;
    this.roundSeconds = timing.roundSeconds;
    this.approachSeconds = timing.approachSeconds;
    this.bpm = options.bpm ?? level.bpm;
    this.rng = createRng(options.seed ?? cfg.seed);
    this.gen = new PatternGenerator(level.pattern, this.rng);
    this.nextArrival = Math.max(timing.approachSeconds, (timing.leadInBeats * 60) / this.bpm);
    this.lastLiftAt = 0;
  }

  get beatSeconds(): number {
    return 60 / this.bpm;
  }

  /** Add one pose frame. `songT` is the song time the frame shows (latency removed). */
  pushFrame(frame: RehabFrame, base: BasePose, songT: number): void {
    const p = frame.pts;
    const s = frame.scale;
    const sample: FootSample = {
      t: songT,
      h: { left: footHeight(p, base, 'left', s), right: footHeight(p, base, 'right', s) },
      knee: { left: kneeRise(p, base, 'left', s), right: kneeRise(p, base, 'right', s) },
      drift: { left: footDrift(p, base, 'left', s), right: footDrift(p, base, 'right', s) },
      lean: trunkLeanDeg(p),
    };
    this.pushSample(sample);
  }

  pushSample(sample: FootSample): void {
    if (this.samples.length && sample.t < this.samples[this.samples.length - 1].t) return;
    this.samples.push(sample);
    this.live = sample;
    while (this.samples.length && sample.t - this.samples[0].t > this.cfg.historySeconds) this.samples.shift();
  }

  private say(text: string, t: number, seconds = 1.5): void {
    this.cue = { text, until: t + seconds };
  }

  private heightFor(leg: Side): number {
    const factor = Math.min(this.cfg.legFactorRange[1], Math.max(this.cfg.legFactorRange[0], this.options.legFactor[leg]));
    const base = pick(this.rng, this.level.heights);
    return Math.max(this.cfg.assist.minHeight, base - this.heightDrop) * factor;
  }

  /** Create bars that come into view by `songNow`. */
  private schedule(songNow: number): void {
    while (this.nextArrival <= this.roundSeconds && this.nextArrival - this.approachSeconds <= songNow + 0.1) {
      const step = this.gen.next();
      if (step !== '-') {
        const leg: Side = step === 'L' ? 'left' : 'right';
        this.bars.push({
          id: this.nextId++,
          leg,
          arrival: this.nextArrival,
          height: this.heightFor(leg),
          judged: false,
          result: null,
          timingError: null,
          peakHeight: 0,
        });
      }
      this.nextArrival += this.level.beatsPerBar * this.beatSeconds;
    }
  }

  update(songNow: number): MarchEvent[] {
    const events: MarchEvent[] = [];
    if (this.finished) return events;
    if (this.cue && songNow > this.cue.until) this.cue = null;
    this.schedule(songNow);
    this.safety(songNow, events);

    for (const bar of this.bars) {
      if (bar.judged) continue;
      if (songNow < bar.arrival + this.level.window + this.cfg.judgeMarginSeconds) break;
      this.judge(bar, events, songNow);
    }
    // Drop bars long past.
    this.bars = this.bars.filter((b) => !b.judged || songNow - b.arrival < 1.5);

    const lastArrival = this.nextArrival - this.level.beatsPerBar * this.beatSeconds;
    if (songNow >= this.roundSeconds && songNow > lastArrival + this.level.window + 0.5 && this.bars.every((b) => b.judged)) {
      this.finished = true;
      events.push({ type: 'finished' });
    }
    return events;
  }

  private safety(songNow: number, events: MarchEvent[]): void {
    const s = this.live;
    if (!s) return;
    // Jump: both feet off the floor.
    const both = s.h.left > this.cfg.jumpPct && s.h.right > this.cfg.jumpPct;
    if (both) {
      this.bothUpSince ??= s.t;
      if (s.t - this.bothUpSince > this.cfg.jumpSeconds && songNow > this.jumpFlagUntil) {
        this.jumps += 1;
        this.jumpFlagUntil = songNow + 1;
        this.jumpAt.push(s.t);
        if (this.jumpAt.length > 20) this.jumpAt.shift();
        this.say('Keep one foot on the floor', songNow, 2);
        events.push({ type: 'safetyPause', message: 'Keep one foot on the floor' });
      }
    } else this.bothUpSince = null;

    // Lean.
    if (s.lean > this.cfg.leanNoPerfectDeg) {
      if (!this.leaning) this.leanEvents += 1;
      this.leaning = true;
    } else this.leaning = false;
    if (s.lean > this.cfg.leanPauseDeg) {
      this.leanHighSince ??= s.t;
      if (s.t - this.leanHighSince >= this.cfg.leanPauseSeconds) {
        this.leanHighSince = null;
        events.push({ type: 'safetyPause', message: 'Stand tall' });
      }
    } else this.leanHighSince = null;

    // Lift events (steps, cadence, rest pause).
    for (const leg of ['left', 'right'] as Side[]) {
      if (this.liftArmed[leg] && s.h[leg] >= this.cfg.liftEventPct) {
        this.liftArmed[leg] = false;
        this.steps += 1;
        this.lastLiftAt = songNow;
      } else if (!this.liftArmed[leg] && s.h[leg] < this.cfg.liftEventLowerPct) this.liftArmed[leg] = true;
    }
    if (songNow - this.lastLiftAt >= this.cfg.noLiftPauseSeconds && songNow > this.approachSeconds) {
      this.lastLiftAt = songNow;
      events.push({ type: 'safetyPause', message: 'Take a rest' });
    }
  }

  /** Timeline was paused (no samples meanwhile); keep the rest timer fair. */
  notifyResumed(songNow: number): void {
    this.lastLiftAt = songNow;
    this.bothUpSince = null;
    this.leanHighSince = null;
  }

  private judge(bar: Bar, events: MarchEvent[], songNow: number): void {
    const cfg = this.cfg;
    const win = this.level.window;
    const leg = bar.leg;
    const other: Side = leg === 'left' ? 'right' : 'left';
    const inWin = this.samples.filter((s) => s.t >= bar.arrival - win && s.t <= bar.arrival + win);
    // A lift that cleared a bar is spent: only samples after the foot came back down count again,
    // so one lift can never clear two close bars on the same leg.
    const used = this.lastUsedPeak[leg];
    let fresh = used;
    if (Number.isFinite(used)) {
      const down = this.samples.find((s) => s.t > used && s.h[leg] < cfg.realStepLowRatio * bar.height);
      fresh = down ? down.t : Infinity;
    }
    const mine = inWin.filter((s) => s.t >= fresh && s.t > used);
    let cue: string | null = null;
    let result: Judgement = 'MISS';

    let peak: FootSample | null = null;
    for (const s of mine) if (!peak || s.h[leg] > peak.h[leg]) peak = s;
    const peakH = peak ? peak.h[leg] : 0;
    bar.peakHeight = peakH;
    let cleared = peak !== null && peakH >= bar.height;

    if (cleared && peak) {
      const before = this.samples.filter((s) => s.t >= bar.arrival - cfg.realStepLookbackSeconds && s.t <= bar.arrival - win);
      const realStep = before.length === 0 || before.some((s) => s.h[leg] < cfg.realStepLowRatio * bar.height);
      const kneeOk = peak.knee[leg] >= cfg.minKneeRiseRatio * bar.height;
      const straight = peak.drift[leg] <= cfg.maxDriftHipWidths;
      const jumped = this.jumpAt.some((jt) => jt >= bar.arrival - win - cfg.jumpSeconds && jt <= bar.arrival + win);
      if (!realStep) cue = 'Put the foot down between steps';
      else if (!kneeOk) cue = 'Lift your knee up';
      else if (!straight) cue = 'Lift the knee straight up';
      else if (jumped) cue = 'Keep one foot on the floor';
      cleared = realStep && kneeOk && straight && !jumped;
    }

    if (cleared && peak) {
      const err = peak.t - bar.arrival;
      const lean = inWin.some((s) => s.lean > cfg.leanNoPerfectDeg);
      result = Math.abs(err) <= cfg.perfectSeconds && !lean ? 'PERFECT' : 'GOOD';
      bar.timingError = err;
      this.lastUsedPeak[leg] = peak.t;
      this.perLeg[leg].errors.push(err);
    } else {
      const otherPeak = inWin.reduce((m, s) => Math.max(m, s.h[other]), 0);
      if (otherPeak >= bar.height && !cue) {
        this.wrongLeg += 1;
        cue = leg === 'left' ? 'Left leg for blue' : 'Right leg for red';
        events.push({ type: 'wrongLeg', bar });
      }
    }

    bar.judged = true;
    bar.result = result;
    this.perLeg[leg].bars += 1;
    if (peak) this.perLeg[leg].peaks.push(peakH);
    let points = 0;
    if (result !== 'MISS') {
      this.perLeg[leg].cleared += 1;
      const sc = cfg.score;
      const mult = Math.min(sc.comboMax, 1 + Math.floor(this.streak / sc.comboEvery));
      points = (result === 'PERFECT' ? sc.perfect : sc.good) * mult;
      this.score += points;
      this.streak += 1;
      this.longest = Math.max(this.longest, this.streak);
    } else this.streak = 0;
    if (cue) this.say(cue, songNow);
    this.lastJudgement = { result, leg, at: songNow };
    events.push({ type: 'judged', bar, cue, points });

    this.recent.push(result);
    if (this.recent.length > cfg.assist.windowBars) this.recent.shift();
    if (this.options.assist && !this.assistUsed && this.recent.length >= cfg.assist.windowBars) {
      const misses = this.recent.filter((r) => r === 'MISS').length;
      if ((100 * misses) / this.recent.length > cfg.assist.missRatePct) {
        this.assistUsed = true;
        this.bpm = Math.max(30, this.bpm - cfg.assist.bpmDrop);
        this.heightDrop = cfg.assist.heightDrop;
        // Bars already scheduled keep the old tempo; the next one sits one old bar on, then the new spacing runs.
        events.push({ type: 'assist', bpm: this.bpm, fromSong: this.nextArrival });
      }
    }
  }

  canUseHoverMenu(): boolean {
    return this.finished;
  }

  clearedPct(): number {
    const bars = this.perLeg.left.bars + this.perLeg.right.bars;
    return bars ? (100 * (this.perLeg.left.cleared + this.perLeg.right.cleared)) / bars : 0;
  }

  meanTimingErrorMs(): number | null {
    const all = [...this.perLeg.left.errors, ...this.perLeg.right.errors].map((e) => Math.abs(e) * 1000);
    return mean(all);
  }

  stars(): number {
    const pct = this.clearedPct();
    const s = this.cfg.stars;
    const err = this.meanTimingErrorMs();
    if (pct >= s.three && err !== null && err < s.threeMaxTimingMs) return 3;
    if (pct >= s.two) return 2;
    if (pct >= s.one) return 1;
    return 0;
  }

  metrics(songNow: number): MarchMetrics {
    const r = (v: number | null, d = 1) => (v === null ? null : Math.round(v * d) / d);
    const L = this.perLeg.left;
    const R = this.perLeg.right;
    const mL = mean(L.peaks);
    const mR = mean(R.peaks);
    const eL = mean(L.errors.map((e) => Math.abs(e) * 1000));
    const eR = mean(R.errors.map((e) => Math.abs(e) * 1000));
    const minutes = Math.max(1 / 60, songNow / 60);
    return {
      level: this.level.id,
      bpm: this.bpm,
      barsClearedPctLeft: L.bars ? Math.round((100 * L.cleared) / L.bars) : null,
      barsClearedPctRight: R.bars ? Math.round((100 * R.cleared) / R.bars) : null,
      meanPeakLeft: r(mL),
      meanPeakRight: r(mR),
      timingErrorMsLeft: r(eL),
      timingErrorMsRight: r(eR),
      timingBiasMsLeft: r(mean(L.errors.map((e) => e * 1000))),
      timingBiasMsRight: r(mean(R.errors.map((e) => e * 1000))),
      cadence: Math.round(this.steps / minutes),
      steps: this.steps,
      symmetryIndex: mL !== null && mR !== null && Math.max(mL, mR) > 0 ? Math.round(100 * (1 - Math.abs(mL - mR) / Math.max(mL, mR))) : null,
      timingSymmetry: eL !== null && eR !== null && Math.max(eL, eR) > 0 ? Math.round(100 * (1 - Math.abs(eL - eR) / Math.max(eL, eR))) : null,
      jumps: this.jumps,
      wrongLegLifts: this.wrongLeg,
      leanEvents: this.leanEvents,
      longestStreak: this.longest,
      score: this.score,
      assistUsed: this.assistUsed,
    };
  }
}
