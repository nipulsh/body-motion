import type { Side } from '../core/geometry';
import type { FormState } from '../core/types';
import squatConfig from './config.json';
import levelsJson from './levels.json';
import type { SquatMeasures } from './math';

export type SquatConfig = typeof squatConfig;
export type SquatLevelsConfig = typeof levelsJson;
export type SquatView = 'front' | 'side';
export type SquatStyleId = keyof SquatLevelsConfig['styles'];

export type CheckId = 'tibia' | 'pelvis' | 'lrDiff' | 'bowing' | 'heelLift' | 'back' | 'shin' | 'speed';
export type FaultId =
  | 'kneeCave'
  | 'kneeOut'
  | 'pelvisTilt'
  | 'lrDiff'
  | 'bowing'
  | 'heelLift'
  | 'backAngle'
  | 'shinAngle'
  | 'tooFast'
  | 'bounce';

export interface SquatLevel {
  id: string;
  name: string;
  depth: [number, number];
  zoneTol: number;
  fruit: number;
  hold: number;
  tempoDown: number | null;
  tempoUp: number | null;
  fruitType: string;
  checks: CheckId[];
  tibiaWiden?: number;
  backRange?: 'gentle' | 'style';
  strict: boolean;
}

export interface CheckResult {
  id: CheckId;
  state: FormState;
  fault: FaultId | null;
  value: number;
}

export interface FormEval {
  overall: FormState;
  checks: CheckResult[];
  /** The worst failing check, for cues and the fault log. */
  worst: CheckResult | null;
  /** Lowering at more than twice the level tempo. */
  slowDown: boolean;
}

const RANK: Record<FormState, number> = { good: 0, borderline: 1, incorrect: 2 };

export function worse(a: FormState, b: FormState): FormState {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Smaller is better: good below `good`, borderline up to `borderline`, incorrect above. */
export function graded(value: number, good: number, borderline: number, strict: boolean, cfg: SquatConfig = squatConfig): FormState {
  const band = (borderline - good) * (strict ? cfg.strictBorderlineScale : 1);
  if (value < good) return 'good';
  if (value <= good + band) return 'borderline';
  return 'incorrect';
}

/** Inside [lo, hi] good, within `border` outside borderline, beyond incorrect. */
export function inRange(value: number, range: readonly [number, number] | readonly number[], border: number): FormState {
  const [lo, hi] = range;
  if (value >= lo && value <= hi) return 'good';
  if (value >= lo - border && value <= hi + border) return 'borderline';
  return 'incorrect';
}

/** Correct tibia range for a toe-out angle. */
export function tibiaRange(toeOutDeg: number, widen = 0, cfg: SquatConfig = squatConfig): [number, number] {
  const band = cfg.tibiaBands.find((b) => toeOutDeg >= b.toeOut[0] && toeOutDeg < b.toeOut[1]) ?? cfg.tibiaBands[cfg.tibiaBands.length - 1];
  return [band.range[0] - widen, band.range[1] + widen];
}

export function tibiaCheck(tibia: number, toeOutDeg: number, widen: number, strict: boolean, active: boolean, cfg: SquatConfig = squatConfig): CheckResult {
  const range = tibiaRange(toeOutDeg, widen, cfg);
  const border = cfg.tibiaBorderline * (strict ? cfg.strictBorderlineScale : 1);
  // Before the knees have bent much only a caving knee is judged.
  const effective: [number, number] = active ? range : [Math.min(range[0], 0), 90];
  const state = inRange(tibia, effective, border);
  const fault: FaultId | null = state === 'good' ? null : tibia < effective[0] ? 'kneeCave' : 'kneeOut';
  return { id: 'tibia', state, fault, value: tibia };
}

export interface StyleRanges {
  back: [number, number];
  shin: [number, number];
}

export function styleRanges(level: SquatLevel, style: SquatStyleId, levels: SquatLevelsConfig = levelsJson): StyleRanges {
  const s = levels.styles[style] ?? levels.styles.standard;
  const back = (level.backRange === 'gentle' ? levels.gentleBack : s.back) as [number, number];
  return { back, shin: s.shin as [number, number] };
}

export interface FormContext {
  view: SquatView;
  level: SquatLevel;
  style: SquatStyleId;
  /** Lowering speed in depth units per second (positive going down). */
  lowerSpeed: number;
  /** Only judged while lowering. */
  lowering: boolean;
}

/** At the bottom of the squat: style and tibia ranges describe this position. */
export function atDepth(m: SquatMeasures, level: SquatLevel): boolean {
  return m.depth >= level.depth[0] - level.zoneTol;
}

/** Before depth only the upper limit applies (too much lean or knee travel). */
function upperOnly(range: readonly [number, number] | readonly number[], deep: boolean): [number, number] {
  return deep ? [range[0], range[1]] : [Math.min(0, range[0]), range[1]];
}

/** Depth units per second the level's tempo allows. */
export function expectedLowerSpeed(level: SquatLevel, levels: SquatLevelsConfig = levelsJson): number {
  const target = (level.depth[0] + level.depth[1]) / 2;
  const tempo = level.tempoDown ?? levels.freeTempoDownSeconds;
  return target / Math.max(0.1, tempo);
}

export function speedCheck(speed: number, expected: number, strict: boolean, cfg: SquatConfig = squatConfig): CheckResult & { slowDown: boolean } {
  const ratio = expected > 0 ? speed / expected : 0;
  const band = cfg.speed.borderlineFaster * (strict ? cfg.strictBorderlineScale : 1);
  const state: FormState = ratio <= 1 ? 'good' : ratio <= 1 + band ? 'borderline' : 'incorrect';
  return { id: 'speed', state, fault: state === 'good' ? null : 'tooFast', value: speed, slowDown: ratio > cfg.speed.slowDownFactor };
}

export function evaluateForm(m: SquatMeasures, ctx: FormContext, cfg: SquatConfig = squatConfig, levels: SquatLevelsConfig = levelsJson): FormEval {
  const { level, view } = ctx;
  const strict = level.strict;
  const checks: CheckResult[] = [];
  let slowDown = false;
  for (const id of level.checks) {
    switch (id) {
      case 'tibia': {
        if (view !== 'front') break;
        const active = atDepth(m, level);
        const per = (['left', 'right'] as Side[]).map((s) =>
          tibiaCheck(m.tibia[s], m.toeOut[s], level.tibiaWiden ?? 0, strict, active, cfg),
        );
        checks.push(RANK[per[0].state] >= RANK[per[1].state] ? per[0] : per[1]);
        break;
      }
      case 'pelvis': {
        const state = graded(m.pelvisTilt, cfg.pelvis.good, cfg.pelvis.borderline, strict, cfg);
        checks.push({ id, state, fault: state === 'good' ? null : 'pelvisTilt', value: m.pelvisTilt });
        break;
      }
      case 'lrDiff': {
        const state = graded(m.lrDiff, cfg.lrDiff.good, cfg.lrDiff.borderline, strict, cfg);
        checks.push({ id, state, fault: state === 'good' ? null : 'lrDiff', value: m.lrDiff });
        break;
      }
      case 'bowing': {
        const state = graded(m.bowing, cfg.bowing.good, cfg.bowing.borderline, strict, cfg);
        checks.push({ id, state, fault: state === 'good' ? null : 'bowing', value: m.bowing });
        break;
      }
      case 'heelLift': {
        const state = graded(m.heelLift, cfg.heelLift.good, cfg.heelLift.borderline, strict, cfg);
        checks.push({ id, state, fault: state === 'good' ? null : 'heelLift', value: m.heelLift });
        break;
      }
      case 'back': {
        if (view !== 'side') break;
        const r = styleRanges(level, ctx.style, levels);
        const border = cfg.angleBorderline * (strict ? cfg.strictBorderlineScale : 1);
        const state = inRange(m.side.backAngle, upperOnly(r.back, atDepth(m, level)), border);
        checks.push({ id, state, fault: state === 'good' ? null : 'backAngle', value: m.side.backAngle });
        break;
      }
      case 'shin': {
        if (view !== 'side') break;
        const r = styleRanges(level, ctx.style, levels);
        const border = cfg.angleBorderline * (strict ? cfg.strictBorderlineScale : 1);
        const state = inRange(m.side.shinAngle, upperOnly(r.shin, atDepth(m, level)), border);
        checks.push({ id, state, fault: state === 'good' ? null : 'shinAngle', value: m.side.shinAngle });
        break;
      }
      case 'speed': {
        if (!ctx.lowering) break;
        const s = speedCheck(ctx.lowerSpeed, expectedLowerSpeed(level, levels), strict, cfg);
        slowDown = s.slowDown;
        checks.push({ id: s.id, state: s.state, fault: s.fault, value: s.value });
        break;
      }
    }
  }
  let overall: FormState = 'good';
  let worst: CheckResult | null = null;
  for (const c of checks) {
    overall = worse(overall, c.state);
    if (c.state !== 'good' && (!worst || RANK[c.state] > RANK[worst.state])) worst = c;
  }
  return { overall, checks, worst, slowDown };
}

/** Levels for a view, after a style's level limits. */
export function squatLevels(view: SquatView, levels: SquatLevelsConfig = levelsJson): SquatLevel[] {
  return (view === 'front' ? levels.front : levels.side) as unknown as SquatLevel[];
}

/** The level with a style's depth override or cap applied. */
export function applyStyle(level: SquatLevel, view: SquatView, style: SquatStyleId, levels: SquatLevelsConfig = levelsJson): SquatLevel {
  if (view !== 'side') return level;
  const s = levels.styles[style];
  if (!s) return level;
  let depth: [number, number] = [level.depth[0], level.depth[1]];
  if (s.depth) depth = [s.depth[0], s.depth[1]];
  if (s.depthCap !== null && s.depthCap !== undefined) depth = [Math.min(depth[0], s.depthCap), Math.min(depth[1], s.depthCap)];
  return { ...level, depth };
}

export function styleAllowsLevel(style: SquatStyleId, levelId: string, levels: SquatLevelsConfig = levelsJson): boolean {
  const s = levels.styles[style];
  return !s || (s.levels as string[]).includes(levelId);
}

export const FAULT_CUES: Record<FaultId, string> = {
  kneeCave: 'Push your knees out',
  kneeOut: 'Knees over your toes',
  pelvisTilt: 'Keep your hips level',
  lrDiff: 'Even weight on both legs',
  bowing: 'Chest up',
  heelLift: 'Keep your heels down',
  backAngle: 'Check your back angle',
  shinAngle: 'Check your knee travel',
  tooFast: 'Slow down',
  bounce: 'Hold still',
};
