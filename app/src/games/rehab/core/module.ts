import type * as THREE from 'three';
import type { MockParams } from '@vision/games/rehab/core/mockSkeleton';
import type { BasePose, RehabFrame, RequiredView } from '@vision/games/rehab/core/types';
import type { RehabAudio } from './audio';
import type { DisplayMapper } from './display';
import type { Bursts, RehabRenderer } from './render';
import type { RehabSettings } from './settings';

export type OptionValues = Record<string, string | boolean>;

export interface LevelDef {
  id: string;
  /** Level number shown in the ring (1..5). */
  number: number;
  name: string;
  /** Not playable with the current options (e.g. a squat style limited to some levels). */
  disabled?: boolean;
}

export interface OptionChoice {
  id: string;
  label: string;
}

export interface OptionDef {
  id: string;
  label: string;
  /** `tabs` picks one choice; `toggle` is an on/off chip. */
  kind: 'tabs' | 'toggle';
  choices?: OptionChoice[];
  /** Hidden unless this returns true for the current options and level. */
  visible?: (options: OptionValues, levelIndex: number) => boolean;
}

export interface HudCue {
  text: string;
  tone: 'good' | 'caution' | 'info';
}

export interface HudState {
  levelName: string;
  /** 0..1 for the thin ring timer (time or reps remaining). */
  ring: number;
  score: number;
  /** e.g. "x2" or "Rep 3/8". */
  combo?: string;
  /** Secondary line under the score (reps, crate meter). */
  detail?: string;
  cue?: HudCue | null;
  /** Bubble game rule card at top centre. */
  ruleCard?: { text: string; next?: string | null; pulse: boolean } | null;
  /** March game: the PERFECT / GOOD / MISS word near a foot (screen px). */
  judgement?: { text: string; tone: 'good' | 'caution' | 'info'; x: number; y: number } | null;
}

export interface ResultNumber {
  label: string;
  value: string;
}

export interface ResultData {
  stars: number;
  score: number;
  numbers: ResultNumber[];
  metrics: Record<string, unknown>;
}

export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: RehabRenderer;
  display: DisplayMapper;
  base: BasePose;
  audio: RehabAudio;
  settings: RehabSettings;
  bursts: Bursts;
}

export interface GameSession {
  requiredView: RequiredView;
  requiredLandmarks: readonly number[];
  seated?: boolean;
  /** Game logic for one new pose frame. Not called while paused. */
  update(dt: number, frame: RehabFrame, base: BasePose): void;
  /** Draw (called every animation frame, also while paused). */
  render(dt: number, frame: RehabFrame | null, playing: boolean): void;
  hud(): HudState;
  canUseHoverMenu(): boolean;
  isFinished(): boolean;
  result(): ResultData;
  /** Clock control for the core pause (tracking lost, Pause button, safety). */
  pause?(): void;
  resume?(): void;
  /** Called once when play starts after the countdown. */
  start?(): void;
  /** A safety pause the game wants (message), consumed once. */
  takePauseRequest?(): string | null;
  /** Scripted mock demo: adjust the mock skeleton for this moment. */
  demo?(t: number, params: MockParams, frame: RehabFrame | null): Partial<MockParams>;
  dispose(): void;
}

export interface GameModule {
  id: string;
  name: string;
  /** Outline SVG path, 24×24 viewBox. */
  icon: string;
  requiredView: RequiredView;
  requiredLandmarks: readonly number[];
  defaultOptions: OptionValues;
  homeOptions?: OptionDef[];
  /** Levels for the current options (the squat game has a front and a side set). */
  levels(options: OptionValues): LevelDef[];
  /** Key for stars and the remembered level: per view for the squat game. */
  levelKey(level: LevelDef, options: OptionValues): string;
  /** Key for the remembered level index. */
  lastLevelKey(options: OptionValues): string;
  requireReadyConfirm?(level: LevelDef, options: OptionValues): boolean;
  /** Landmarks tracking must see for this level and options (default: requiredLandmarks). */
  landmarksFor?(level: LevelDef, options: OptionValues): readonly number[];
  /** Seated play skips the head-to-toe and leg-length checks. */
  seatedFor?(options: OptionValues): boolean;
  /** Options after a change, so dependent choices stay valid. */
  normalizeOptions?(options: OptionValues): OptionValues;
  createSession(ctx: GameContext, level: LevelDef, options: OptionValues): GameSession;
}
