import type { PoseResult } from '@vision';
import coreConfig from '@vision/games/rehab/core/config.json';
import { RehabTracker } from '@vision/games/rehab/core/tracking';
import type { BasePose, RehabFrame, RequiredView, TrackingStatus } from '@vision/games/rehab/core/types';
import { RehabAudio } from './audio';
import { DisplayMapper } from './display';
import type { GameContext, GameModule, GameSession, HudState, LevelDef, OptionValues, ResultData } from './module';
import { Bursts, RehabRenderer } from './render';
import type { RehabSettings } from './settings';
import { recordStars, saveSession } from './storage';

export type PlayPhase = 'idle' | 'base' | 'ready' | 'countdown' | 'playing' | 'paused' | 'finished';
export type PauseKind = 'tracking' | 'user' | 'safety';

export interface PlayView {
  phase: PlayPhase;
  /** Line shown during base check, pauses and tracking problems. */
  message: string | null;
  baseProgress: number;
  baseLocked: boolean;
  countdown: number;
  pauseKind: PauseKind | null;
  hud: HudState | null;
  readyLine: string | null;
}

export interface SessionEnd {
  result: ResultData;
  endedBy: 'complete' | 'exit' | 'hurts';
  module: GameModule;
  level: LevelDef;
  options: OptionValues;
}

interface Active {
  module: GameModule;
  level: LevelDef;
  options: OptionValues;
  requiredView: RequiredView;
  session: GameSession | null;
  ctx: GameContext | null;
  readyConfirm: boolean;
  startedAt: number;
  playedAt: number | null;
  countdownStart: number;
  lastBeep: number;
  pauseKind: PauseKind | null;
  pauseMessage: string | null;
  goodSince: number | null;
  hurts: number;
}

const VIEW_MESSAGE: Record<'front' | 'side', string> = {
  front: coreConfig.trackingMessages.front,
  side: coreConfig.trackingMessages.side,
};

/**
 * Session flow shared by every game: tracking and the automatic base pose,
 * optional Ready confirm, 3-2-1 countdown, play with automatic pause on lost
 * tracking or the wrong view, user and safety pauses, Hurts, and the result.
 */
export class RehabEngine {
  readonly tracker = new RehabTracker({ requiredLandmarks: [11, 12, 23, 24] });
  readonly display = new DisplayMapper();
  readonly audio = new RehabAudio();
  renderer: RehabRenderer | null = null;
  bursts: Bursts | null = null;
  settings: RehabSettings;
  status: TrackingStatus | null = null;
  phase: PlayPhase = 'idle';
  onEnd: ((end: SessionEnd) => void) | null = null;

  private active: Active | null = null;
  private pendingFrame: RehabFrame | null = null;
  private lastUpdateT: number | null = null;
  private lastTick: number | null = null;

  constructor(settings: RehabSettings) {
    this.settings = settings;
    this.applySettings(settings);
  }

  applySettings(settings: RehabSettings): void {
    this.settings = settings;
    this.display.alignment = settings.alignment;
    this.audio.setMuted(settings.muted);
    this.audio.audioOffset = settings.audioOffsetMs / 1000;
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    this.detachCanvas();
    this.renderer = new RehabRenderer(canvas);
    this.bursts = new Bursts();
    this.renderer.scene.add(this.bursts.object);
  }

  detachCanvas(): void {
    this.active?.session?.dispose();
    if (this.active) this.active.session = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.bursts = null;
  }

  onPose(pose: PoseResult | null): void {
    const now = performance.now();
    const ts = pose && Number.isFinite(pose.timestamp) && Math.abs(now - pose.timestamp) < 2000 ? pose.timestamp : now;
    this.status = this.tracker.update(pose, ts / 1000);
    if (this.status.frame && this.status.frame.aspect > 0) this.display.aspect = this.status.frame.aspect;
    if (this.status.frame && this.status.healthy) this.pendingFrame = this.status.frame;
    const base = this.tracker.getBase();
    if (base) this.display.legLength = base.legLength;
  }

  get session(): GameSession | null {
    return this.active?.session ?? null;
  }

  get current(): { module: GameModule; level: LevelDef; options: OptionValues } | null {
    return this.active ? { module: this.active.module, level: this.active.level, options: this.active.options } : null;
  }

  start(module: GameModule, level: LevelDef, options: OptionValues, landmarks: readonly number[], seated: boolean): void {
    this.stop();
    const requiredView: RequiredView = module.id === 'squat' ? (options.view === 'side' ? 'side' : 'front') : module.requiredView;
    this.tracker.configure(landmarks, seated);
    this.tracker.resetBase();
    this.audio.unlock();
    this.active = {
      module,
      level,
      options,
      requiredView,
      session: null,
      ctx: null,
      readyConfirm: module.requireReadyConfirm?.(level, options) ?? false,
      startedAt: performance.now() / 1000,
      playedAt: null,
      countdownStart: 0,
      lastBeep: -1,
      pauseKind: null,
      pauseMessage: null,
      goodSince: null,
      hurts: 0,
    };
    this.phase = 'base';
  }

  /** Leave without a result (Exit). Logs the session if play had started. */
  exit(): void {
    const a = this.active;
    if (a?.session && a.playedAt !== null) this.finish('exit');
    this.stop();
  }

  /** Hurts: ends the session at once, logs it and suggests a lower level. */
  hurts(): void {
    const a = this.active;
    if (!a) return;
    a.hurts += 1;
    this.finish('hurts');
  }

  confirmReady(): void {
    if (this.phase !== 'ready' || !this.active) return;
    this.beginCountdown();
  }

  togglePause(): void {
    const a = this.active;
    if (!a) return;
    if (this.phase === 'playing') this.pause('user', 'Paused');
    else if (this.phase === 'paused' && a.pauseKind !== 'tracking') this.resume();
  }

  private stop(): void {
    this.active?.session?.dispose();
    this.active = null;
    this.phase = 'idle';
    this.pendingFrame = null;
    this.lastUpdateT = null;
    void this.audio.setPaused(false);
    this.audio.stopTrack();
  }

  private beginCountdown(): void {
    const a = this.active!;
    a.countdownStart = performance.now() / 1000;
    a.lastBeep = -1;
    this.phase = 'countdown';
  }

  private pause(kind: PauseKind, message: string): void {
    const a = this.active;
    if (!a || this.phase !== 'playing') return;
    a.pauseKind = kind;
    a.pauseMessage = message;
    a.goodSince = null;
    a.session?.pause?.();
    this.phase = 'paused';
  }

  private resume(): void {
    const a = this.active;
    if (!a || this.phase !== 'paused') return;
    a.pauseKind = null;
    a.pauseMessage = null;
    this.lastUpdateT = null;
    a.session?.resume?.();
    this.phase = 'playing';
  }

  private finish(endedBy: SessionEnd['endedBy']): void {
    const a = this.active;
    if (!a) return;
    const session = a.session;
    const result: ResultData = session ? session.result() : { stars: 0, score: 0, numbers: [], metrics: {} };
    if (endedBy !== 'complete') result.stars = 0;
    const levelKey = a.module.levelKey(a.level, a.options);
    if (endedBy === 'complete') recordStars(a.module.id, levelKey, result.stars);
    const duration = Math.round(performance.now() / 1000 - (a.playedAt ?? a.startedAt));
    void saveSession({
      date: new Date().toISOString(),
      gameId: a.module.id,
      level: levelKey,
      options: a.options,
      durationSeconds: duration,
      score: result.score,
      stars: result.stars,
      hurtsPresses: a.hurts,
      endedBy,
      metrics: result.metrics,
    }).catch(() => {});
    const end: SessionEnd = { result, endedBy, module: a.module, level: a.level, options: a.options };
    this.stop();
    this.phase = 'finished';
    this.onEnd?.(end);
  }

  private viewOk(base: BasePose | null): string | null {
    const a = this.active;
    const s = this.status;
    if (!a || !s || a.requiredView === 'either') return null;
    const view = s.view === 'unknown' ? base?.view ?? 'unknown' : s.view;
    if (view !== 'unknown' && view !== a.requiredView) return VIEW_MESSAGE[a.requiredView];
    return null;
  }

  /** Advance the flow and draw. Call once per animation frame. */
  tick(nowMs: number, dpr: number): void {
    const now = nowMs / 1000;
    const dt = this.lastTick === null ? 0 : Math.min(0.1, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const a = this.active;
    const s = this.status;
    const renderer = this.renderer;
    if (renderer) renderer.layout(this.display, dpr);

    if (a) {
      switch (this.phase) {
        case 'base': {
          const base = this.tracker.getBase();
          if (base) {
            const wrongView = a.requiredView !== 'either' && base.view !== a.requiredView;
            if (wrongView) {
              this.tracker.resetBase();
              break;
            }
            if (!renderer || !this.bursts) break;
            a.ctx = { scene: renderer.scene, camera: renderer.camera, renderer, display: this.display, base, audio: this.audio, settings: this.settings, bursts: this.bursts };
            a.session = a.module.createSession(a.ctx, a.level, a.options);
            if (a.readyConfirm) this.phase = 'ready';
            else this.beginCountdown();
          }
          break;
        }
        case 'countdown': {
          const left = coreConfig.countdownSeconds - (now - a.countdownStart);
          const n = Math.ceil(left);
          if (n !== a.lastBeep && n > 0) {
            a.lastBeep = n;
            this.audio.countdown(false);
          }
          if (left <= 0) {
            this.audio.countdown(true);
            a.playedAt = now;
            this.phase = 'playing';
            this.lastUpdateT = null;
            a.session?.start?.();
          }
          break;
        }
        case 'playing': {
          const base = this.tracker.getBase();
          const viewProblem = this.viewOk(base);
          if (!s || !s.healthy || viewProblem || !base) {
            this.pause('tracking', viewProblem ?? (s && !s.healthy ? s.message : null) ?? 'Stand still so I can see you');
            break;
          }
          // Slow re-base keeps the scene placed on the patient.
          if (a.ctx) a.ctx.base = base;
          const frame = this.pendingFrame;
          if (frame && base && a.session) {
            this.pendingFrame = null;
            const fdt = this.lastUpdateT === null ? 0 : Math.max(0, frame.t - this.lastUpdateT);
            this.lastUpdateT = frame.t;
            a.session.update(fdt, frame, base);
            const req = a.session.takePauseRequest?.();
            if (req) this.pause('safety', req);
            if (a.session.isFinished()) {
              this.finish('complete');
              return;
            }
          }
          break;
        }
        case 'paused': {
          if (a.pauseKind === 'tracking') {
            const good = s?.healthy && this.tracker.getBase() !== null && !this.viewOk(this.tracker.getBase());
            if (good) {
              a.goodSince ??= now;
              if (now - a.goodSince >= coreConfig.tracking.resumeAfterSeconds) this.resume();
            } else {
              a.goodSince = null;
              if (s && !s.healthy && s.message) a.pauseMessage = s.message;
              const vp = this.viewOk(this.tracker.getBase());
              if (vp) a.pauseMessage = vp;
              else if (s?.healthy && !this.tracker.getBase()) a.pauseMessage = 'Stand still so I can see you';
            }
          }
          break;
        }
        default:
          break;
      }
    }

    if (renderer) {
      const session = this.active?.session;
      const frame = this.status?.frame ?? null;
      session?.render(dt, frame, this.phase === 'playing');
      this.bursts?.update(dt, 1.2);
      renderer.render();
    }
  }

  /** Snapshot for the React overlay. */
  view(): PlayView {
    const a = this.active;
    const s = this.status;
    let message: string | null = null;
    if (this.phase === 'base') {
      const vp = a && a.requiredView !== 'either' && s && s.view !== 'unknown' && s.view !== a.requiredView ? VIEW_MESSAGE[a.requiredView] : null;
      message = vp ?? (s && !s.healthy ? s.message : 'Stand still');
    } else if (this.phase === 'paused') message = a?.pauseMessage ?? null;
    const countdown = a && this.phase === 'countdown' ? Math.max(1, Math.ceil(coreConfig.countdownSeconds - (performance.now() / 1000 - a.countdownStart))) : 0;
    return {
      phase: this.phase,
      message,
      baseProgress: s?.baseProgress ?? 0,
      baseLocked: Boolean(this.tracker.getBase()),
      countdown,
      pauseKind: a?.pauseKind ?? null,
      hud: a?.session && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'countdown') ? a.session.hud() : null,
      readyLine: this.phase === 'ready' ? 'Hold a rail or chair' : null,
    };
  }

  canUseHoverMenu(): boolean {
    if (this.phase === 'playing') return this.active?.session?.canUseHoverMenu() ?? false;
    return true;
  }

  dispose(): void {
    this.stop();
    this.detachCanvas();
    this.audio.dispose();
  }
}
