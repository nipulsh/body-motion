import * as THREE from 'three';
import coreConfig from '@vision/games/rehab/core/config.json';
import { sideIdx, type Side } from '@vision/games/rehab/core/geometry';
import type { MockParams } from '@vision/games/rehab/core/mockSkeleton';
import type { BasePose, RehabFrame } from '@vision/games/rehab/core/types';
import marchConfig from '@vision/games/rehab/march/config.json';
import { MARCH_LEVELS, MARCH_TIMING, MarchGame, type Bar, type MarchEvent } from '@vision/games/rehab/march/game';
import type { GameContext, GameModule, GameSession, HudState, LevelDef, OptionValues, ResultData } from '../core/module';
import { circleLine, glowMeshMaterial, outline, polyline, setLinePoints, Trail } from '../core/render';

const C = coreConfig.colors;
const SIDE_COLOUR: Record<Side, string> = { left: C.left, right: C.right };
/** World units (leg lengths) a bar travels from spawn to the patient. */
const APPROACH_DISTANCE = 7;
const PASS_DISTANCE = 1.5;

interface BarView {
  group: THREE.Group;
  rod: THREE.Mesh;
  rodMat: THREE.MeshBasicMaterial;
  edge: THREE.LineSegments;
  flash: number;
}

class MarchSession implements GameSession {
  readonly requiredView = 'front' as const;
  readonly requiredLandmarks = marchConfig.requiredLandmarks;
  private readonly game: MarchGame;
  private readonly ctx: GameContext;
  private readonly root = new THREE.Group();
  private readonly lanes: Record<Side, THREE.Line>;
  private readonly orbs: Record<Side, THREE.LineLoop>;
  private readonly trails: Record<Side, Trail>;
  private readonly bars = new Map<number, BarView>();
  private readonly level: LevelDef;
  private lastFrame: RehabFrame | null = null;
  private started = false;
  private pauseRequest: string | null = null;
  private music: AudioBuffer | null = null;

  constructor(ctx: GameContext, level: LevelDef, _options: OptionValues) {
    this.ctx = ctx;
    this.level = level;
    const def = MARCH_LEVELS.find((l) => l.id === level.id) ?? MARCH_LEVELS[0];
    const musicBpm = marchConfig.music.url && marchConfig.music.bpm ? Number(marchConfig.music.bpm) : undefined;
    this.game = new MarchGame(def, { legFactor: { ...ctx.settings.legFactor }, assist: ctx.settings.assist, bpm: musicBpm });
    this.lanes = {
      left: polyline([new THREE.Vector3(), new THREE.Vector3()], C.left, 0.55),
      right: polyline([new THREE.Vector3(), new THREE.Vector3()], C.right, 0.55),
    };
    this.orbs = { left: circleLine(1, C.left, 32), right: circleLine(1, C.right, 32) };
    this.trails = { left: new Trail(C.left, 6), right: new Trail(C.right, 6) };
    this.root.add(this.lanes.left, this.lanes.right, this.orbs.left, this.orbs.right, this.trails.left.line, this.trails.right.line);
    ctx.scene.add(this.root);
    ctx.renderer.setHorizon(this.horizonY());
    if (marchConfig.music.url) {
      void ctx.audio.loadBuffer(String(marchConfig.music.url)).then((b) => {
        this.music = b;
      });
    }
  }

  /** Eye level, so the lanes run to a natural vanishing point. */
  private horizonY(): number {
    const base = this.ctx.base;
    const eye = { x: base.hipMid.x, y: base.hipMid.y - base.torsoLength * 1.35 };
    return this.ctx.display.toWorld(eye).y;
  }

  private songNow(): number {
    return this.started ? this.ctx.audio.songTime() : 0;
  }

  start(): void {
    const audio = this.ctx.audio;
    audio.audioOffset = this.ctx.settings.audioOffsetMs / 1000;
    audio.startTrack({ bpm: this.game.bpm, buffer: this.music, bufferOffset: Number(marchConfig.music.offsetSeconds) || 0 }, 0.15);
    this.started = true;
  }

  pause(): void {
    void this.ctx.audio.setPaused(true);
  }

  resume(): void {
    void this.ctx.audio.setPaused(false).then(() => this.game.notifyResumed(this.songNow()));
  }

  takePauseRequest(): string | null {
    const r = this.pauseRequest;
    this.pauseRequest = null;
    return r;
  }

  update(_dt: number, frame: RehabFrame, base: BasePose): void {
    this.lastFrame = frame;
    if (!this.started) return;
    const now = this.songNow();
    const age = Math.max(0, performance.now() / 1000 - frame.t);
    const songT = now - age - this.ctx.settings.cameraLatencyMs / 1000;
    this.game.pushFrame(frame, base, songT);
    for (const e of this.game.update(now)) this.onEvent(e);
  }

  private onEvent(e: MarchEvent): void {
    const audio = this.ctx.audio;
    switch (e.type) {
      case 'judged': {
        const view = this.bars.get(e.bar.id);
        if (e.bar.result === 'MISS') {
          audio.thud();
          if (view) view.flash = -1;
        } else {
          audio.whoosh();
          if (view) view.flash = 1;
          const foot = this.footWorld(e.bar.leg);
          if (foot) this.ctx.bursts.burst(foot, SIDE_COLOUR[e.bar.leg], e.bar.result === 'PERFECT' ? 26 : 14, 0.6, 0.5);
        }
        break;
      }
      case 'safetyPause':
        this.pauseRequest = e.message;
        break;
      case 'assist':
        audio.setTrackBpm(e.bpm, e.fromSong);
        break;
      case 'wrongLeg':
      case 'finished':
        break;
    }
  }

  private footWorld(side: Side): THREE.Vector3 | null {
    const f = this.lastFrame;
    if (!f) return null;
    const i = sideIdx(side);
    const heel = f.pts[i.heel];
    const toe = f.pts[i.foot];
    const low = heel.y > toe.y ? heel : toe;
    return this.ctx.display.toWorld({ x: (heel.x + toe.x) / 2, y: low.y }, 0.02);
  }

  private makeBar(bar: Bar): BarView {
    const hex = SIDE_COLOUR[bar.leg];
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 0.03, 0.05);
    const rodMat = glowMeshMaterial(hex, 0.75);
    const rod = new THREE.Mesh(geo, rodMat);
    const edge = outline(geo, hex, 1);
    group.add(rod, edge);
    this.root.add(group);
    const view = { group, rod, rodMat, edge, flash: 0 };
    this.bars.set(bar.id, view);
    return view;
  }

  render(dt: number, frame: RehabFrame | null): void {
    const display = this.ctx.display;
    const base = this.ctx.base;
    const now = this.songNow();
    this.ctx.renderer.setHorizon(this.horizonY());
    const hipW = display.len(base.hipWidth);

    // Lanes from each foot to the vanishing point.
    for (const side of ['left', 'right'] as Side[]) {
      const x = display.toWorld({ x: base.ankleX[side], y: base.floorY[side] }).x;
      const y = display.floorY(base, side);
      setLinePoints(this.lanes[side], [new THREE.Vector3(x, y, 0.6), new THREE.Vector3(x, y, -APPROACH_DISTANCE * 1.4)]);
    }

    // Bars.
    const live = new Set<number>();
    for (const bar of this.game.bars) {
      const dz = (bar.arrival - now) / this.game.approachSeconds;
      const z = -APPROACH_DISTANCE * dz;
      if (z < -APPROACH_DISTANCE * 1.05 || z > PASS_DISTANCE) continue;
      live.add(bar.id);
      const v = this.bars.get(bar.id) ?? this.makeBar(bar);
      const laneX = display.toWorld({ x: base.ankleX[bar.leg], y: base.floorY[bar.leg] }).x;
      const y = display.floorY(base, bar.leg) + bar.height / 100;
      const shake = v.flash < 0 ? Math.sin(now * 70) * 0.02 * -v.flash : 0;
      v.group.position.set(laneX + shake, y, z);
      v.group.scale.set(hipW * 1.3, 1, 1);
      const past = Math.max(0, z / PASS_DISTANCE);
      const fadeIn = Math.min(1, (APPROACH_DISTANCE * 1.05 + z) / 1.5);
      let opacity = 0.75 * fadeIn * (1 - past);
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 1.5);
        opacity = Math.min(1, opacity + 0.25);
        v.rodMat.color.set('#ffffff').lerp(new THREE.Color(SIDE_COLOUR[bar.leg]), 1 - v.flash);
      } else if (v.flash < 0) {
        v.flash = Math.min(0, v.flash + dt * 2);
        v.rodMat.color.set(C.grey);
        opacity *= 0.6;
      }
      v.rodMat.opacity = opacity;
      (v.edge.material as THREE.LineBasicMaterial).opacity = Math.min(1, opacity + 0.2);
    }
    for (const [id, v] of this.bars) {
      if (live.has(id)) continue;
      this.root.remove(v.group);
      v.rod.geometry.dispose();
      v.rodMat.dispose();
      v.edge.geometry.dispose();
      (v.edge.material as THREE.Material).dispose();
      this.bars.delete(id);
    }

    // Foot orbs.
    const f = frame ?? this.lastFrame;
    for (const side of ['left', 'right'] as Side[]) {
      const p = f ? this.footWorld(side) : null;
      const orb = this.orbs[side];
      orb.visible = p !== null;
      if (p) {
        orb.position.copy(p);
        orb.scale.setScalar(hipW * 0.25);
      }
      this.trails[side].push(p);
    }
  }

  hud(): HudState {
    const g = this.game;
    const now = this.songNow();
    const sc = marchConfig.score;
    const mult = Math.min(sc.comboMax, 1 + Math.floor(g.streak / sc.comboEvery));
    let judgement: HudState['judgement'] = null;
    const j = g.lastJudgement;
    if (j && now - j.at < 0.7 && this.lastFrame) {
      const i = sideIdx(j.leg);
      const s = this.ctx.display.toScreen(this.lastFrame.pts[i.knee]);
      judgement = { text: j.result, tone: j.result === 'PERFECT' ? 'good' : j.result === 'GOOD' ? 'info' : 'caution', x: s.x, y: s.y };
    }
    return {
      levelName: `${this.level.number} ${g.level.name}`,
      ring: Math.max(0, 1 - now / g.roundSeconds),
      score: g.score,
      combo: `x${mult}`,
      cue: g.cue && now < g.cue.until ? { text: g.cue.text, tone: 'caution' } : null,
      judgement,
    };
  }

  canUseHoverMenu(): boolean {
    return this.game.canUseHoverMenu();
  }

  isFinished(): boolean {
    return this.game.finished;
  }

  result(): ResultData {
    const g = this.game;
    const m = g.metrics(Math.min(this.songNow(), g.roundSeconds));
    const err = g.meanTimingErrorMs();
    return {
      stars: g.stars(),
      score: g.score,
      numbers: [
        { label: 'Bars cleared', value: `${Math.round(g.clearedPct())}%` },
        { label: 'Timing', value: err === null ? '–' : `${Math.round(err)} ms` },
        { label: 'Symmetry', value: m.symmetryIndex === null ? '–' : `${m.symmetryIndex}%` },
        { label: 'Cadence', value: `${m.cadence}/min` },
      ],
      metrics: { ...m },
    };
  }

  /** Mock demo: lift each foot to clear every bar, peaking on the beat. */
  demo(): Partial<MockParams> {
    const now = this.songNow();
    const latency = this.ctx.settings.cameraLatencyMs / 1000;
    const lift: Record<Side, number> = { left: 0, right: 0 };
    for (const bar of this.game.bars) {
      const k = (now - (bar.arrival + latency)) / 0.33;
      if (Math.abs(k) < 1) lift[bar.leg] = Math.max(lift[bar.leg], (bar.height + 6) * Math.cos((k * Math.PI) / 2));
    }
    return { view: 'front', hipDropPct: 0, trunkLeanDeg: 0, leftFootLift: lift.left, rightFootLift: lift.right, heelKick: false, leftWrist: null, rightWrist: null };
  }

  dispose(): void {
    this.ctx.audio.stopTrack();
    void this.ctx.audio.setPaused(false);
    this.ctx.renderer.setHorizon(0);
    this.ctx.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}

export const marchModule: GameModule = {
  id: 'march',
  name: 'March to the Beat',
  icon: 'M9 4v7l-3 8 M15 4v5l3 3v7 M4 21h16',
  requiredView: 'front',
  requiredLandmarks: marchConfig.requiredLandmarks,
  defaultOptions: {},
  levels: () => MARCH_LEVELS.map((l, i) => ({ id: l.id, number: i + 1, name: l.name })),
  levelKey: (level) => level.id,
  lastLevelKey: () => 'march',
  requireReadyConfirm: () => true,
  createSession: (ctx, level, options) => new MarchSession(ctx, level, options),
};

export { MARCH_TIMING };
