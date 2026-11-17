import * as THREE from 'three';
import coreConfig from '@vision/games/rehab/core/config.json';
import { LM, mid } from '@vision/games/rehab/core/geometry';
import { MOCK_BODY, type MockParams } from '@vision/games/rehab/core/mockSkeleton';
import type { BasePose, FormState, RehabFrame } from '@vision/games/rehab/core/types';
import squatConfig from '@vision/games/rehab/squat/config.json';
import levelsJson from '@vision/games/rehab/squat/levels.json';
import { squatLevels, styleAllowsLevel, styleRanges, type SquatStyleId, type SquatView } from '@vision/games/rehab/squat/form';
import { FruitCatcherGame, type SquatEvent } from '@vision/games/rehab/squat/rep';
import type { GameContext, GameModule, GameSession, HudState, LevelDef, OptionValues, ResultData } from '../core/module';
import { glowMeshMaterial, outline, polyline } from '../core/render';

const C = coreConfig.colors;
/** Level 1–5 fruit, in the same chart order as the home rings: cyan, green, gold, purple, red. */
const FRUIT_COLOURS: Record<string, string> = {
  cherry: C.left,
  plum: C.good,
  apple: C.caution,
  orange: C.purple,
  golden: C.right,
};
const FORM_COLOUR: Record<FormState, string> = { good: C.good, borderline: C.caution, incorrect: C.right };
const MAX_FRUIT = 8;

type FruitState = 'branch' | 'toBasket' | 'basket' | 'toBranch' | 'toCrate' | 'falling' | 'hidden';

interface Fruit {
  state: FruitState;
  t: number;
  from: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  alpha: number;
}

function arc(from: THREE.Vector3, to: THREE.Vector3, k: number, height: number, out: THREE.Vector3): THREE.Vector3 {
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  out.lerpVectors(from, to, e);
  out.y += Math.sin(Math.PI * k) * height;
  return out;
}

/** Wireframe-woven basket from a lathe profile, with a handle and a form-coloured rim. */
function buildBasket(): { group: THREE.Group; rim: THREE.Mesh; rimMat: THREE.MeshBasicMaterial } {
  const group = new THREE.Group();
  const profile = [
    new THREE.Vector2(0.0, -0.32),
    new THREE.Vector2(0.32, -0.3),
    new THREE.Vector2(0.42, -0.18),
    new THREE.Vector2(0.48, 0.0),
    new THREE.Vector2(0.5, 0.05),
  ];
  const lathe = new THREE.LatheGeometry(profile, 18);
  const weave = new THREE.Mesh(lathe, new THREE.MeshBasicMaterial({ color: C.caution, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(weave);
  const rimMat = glowMeshMaterial(C.good, 0.95);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 8, 48), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  group.add(rim);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 6, 32, Math.PI), new THREE.MeshBasicMaterial({ color: C.caution, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  handle.position.y = 0.05;
  group.add(handle);
  return { group, rim, rimMat };
}

/** Wireframe crate with one slot per rep. */
function buildCrate(slots: number): { group: THREE.Group; slots: THREE.Mesh[]; box: THREE.LineSegments } {
  const group = new THREE.Group();
  const box = outline(new THREE.BoxGeometry(1.0, 0.5, 0.5), C.caution, 0.9);
  group.add(box);
  const slotMeshes: THREE.Mesh[] = [];
  const cols = Math.ceil(slots / 2);
  for (let i = 0; i < slots; i += 1) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), glowMeshMaterial('#ffffff', 0.08));
    const col = i % cols;
    const row = Math.floor(i / cols);
    m.position.set(-0.35 + (0.7 * col) / Math.max(1, cols - 1), 0.1 - row * 0.2, 0.26);
    group.add(m);
    slotMeshes.push(m);
  }
  return { group, slots: slotMeshes, box };
}

class SquatSession implements GameSession {
  readonly requiredView: SquatView;
  readonly requiredLandmarks = squatConfig.requiredLandmarks;
  private readonly game: FruitCatcherGame;
  private readonly ctx: GameContext;
  private readonly root = new THREE.Group();
  private readonly basket: ReturnType<typeof buildBasket>;
  private readonly crate: ReturnType<typeof buildCrate>;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly branches: THREE.Line[] = [];
  private readonly fruitMesh: THREE.InstancedMesh;
  private readonly fruits: Fruit[] = [];
  private readonly fruitColour: THREE.Color;
  private ringY = 0;
  private ringYReady = false;
  private squash = 0;
  private crateGlow = 0;
  private lastFrame: RehabFrame | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly mat4 = new THREE.Matrix4();
  private readonly levelDef: LevelDef;
  private readonly style: SquatStyleId;
  private startAt = 0;

  constructor(ctx: GameContext, level: LevelDef, options: OptionValues) {
    this.ctx = ctx;
    this.levelDef = level;
    const view = (options.view === 'side' ? 'side' : 'front') as SquatView;
    this.style = (typeof options.style === 'string' && options.style in levelsJson.styles ? options.style : 'standard') as SquatStyleId;
    this.requiredView = view;
    const def = squatLevels(view).find((l) => l.id === level.id) ?? squatLevels(view)[0];
    this.game = new FruitCatcherGame(def, { view, style: this.style });

    this.basket = buildBasket();
    this.root.add(this.basket.group);
    this.crate = buildCrate(levelsJson.repsPerSet);
    this.root.add(this.crate.group);
    this.ringMat = glowMeshMaterial(C.grey, 0.9);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 72), this.ringMat);
    this.ring.rotation.x = Math.PI / 2.3;
    this.root.add(this.ring);
    for (let i = 0; i < 2; i += 1) {
      const line = polyline([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], C.good, 0.7);
      this.branches.push(line);
      this.root.add(line);
    }
    this.fruitColour = new THREE.Color(FRUIT_COLOURS[this.game.level.fruitType] ?? FRUIT_COLOURS.apple);
    const fruitMat = new THREE.MeshStandardMaterial({ color: this.fruitColour, emissive: this.fruitColour, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.1, transparent: true });
    this.fruitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), fruitMat, MAX_FRUIT);
    this.fruitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.fruitMesh);
    for (let i = 0; i < MAX_FRUIT; i += 1) {
      this.fruits.push({ state: i < this.game.level.fruit ? 'branch' : 'hidden', t: 0, from: new THREE.Vector3(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), alpha: 1 });
    }
    ctx.scene.add(this.root);
  }

  // ---- Placement ---------------------------------------------------------

  private worldAtDepth(sx: number, sy: number, z: number): THREE.Vector3 {
    const v = this.ctx.display.screenToWorld(sx, sy);
    const cam = this.ctx.camera.position;
    const k = (cam.z - z) / cam.z;
    return new THREE.Vector3(v.x * k, cam.y + (v.y - cam.y) * k, z);
  }

  private hipWorld(frame: RehabFrame | null): THREE.Vector3 {
    const base = this.ctx.base;
    const p = frame ? mid(frame.pts[LM.lHip], frame.pts[LM.rHip]) : base.hipMid;
    return this.ctx.display.toWorld(p, 0.25);
  }

  private fruitRadius(): number {
    return { cherry: 0.035, plum: 0.042, apple: 0.05, orange: 0.052, golden: 0.055 }[this.game.level.fruitType] ?? 0.045;
  }

  private branchSlot(i: number): THREE.Vector3 {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const hip = this.ctx.display.toWorld(this.ctx.base.hipMid);
    return new THREE.Vector3(hip.x + side * (0.62 + k * 0.08), this.ringY - 0.06 - (k % 2) * 0.05, -0.6);
  }

  private basketSlot(i: number, basketPos: THREE.Vector3, width: number): THREE.Vector3 {
    const a = (i / Math.max(1, this.game.level.fruit)) * Math.PI * 2;
    const r = width * 0.18;
    return new THREE.Vector3(basketPos.x + Math.cos(a) * r, basketPos.y + width * 0.02 + Math.floor(i / 3) * width * 0.12, basketPos.z + Math.sin(a) * r * 0.5);
  }

  private crateSlot(i: number): THREE.Vector3 {
    const s = this.crate.slots[i % this.crate.slots.length];
    return s.getWorldPosition(new THREE.Vector3());
  }

  // ---- Logic -------------------------------------------------------------

  start(): void {
    this.startAt = performance.now() / 1000;
  }

  update(_dt: number, frame: RehabFrame, base: BasePose): void {
    this.lastFrame = frame;
    const events = this.game.update(frame, base);
    for (const e of events) this.onEvent(e);
  }

  private onEvent(e: SquatEvent): void {
    const audio = this.ctx.audio;
    switch (e.type) {
      case 'fruitCollected': {
        const f = this.fruits[e.index];
        if (!f) break;
        f.from.copy(f.state === 'branch' ? this.branchSlot(e.index) : f.pos);
        f.state = 'toBasket';
        f.t = 0;
        f.alpha = 1;
        audio.pop(0.4 + e.index * 0.08);
        this.squash = 1;
        break;
      }
      case 'fruitReturned':
        for (const f of this.fruits) {
          if (f.state === 'basket' || f.state === 'toBasket') {
            f.from.copy(f.pos);
            f.state = 'toBranch';
            f.t = 0;
          }
        }
        break;
      case 'spill':
        audio.lowTone();
        for (const f of this.fruits) {
          if (f.state === 'basket' || f.state === 'toBasket') {
            f.state = 'falling';
            f.t = 0;
            f.vel.set((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.3, 0.3);
          }
        }
        break;
      case 'emptyFruit': {
        const f = this.fruits[e.index];
        if (!f) break;
        f.from.copy(f.pos);
        f.state = 'toCrate';
        f.t = 0;
        audio.chime();
        break;
      }
      case 'repCounted':
        this.crateGlow = 1;
        break;
      case 'setComplete':
        audio.celebrate();
        this.ctx.bursts.burst(this.crate.group.position.clone(), C.caution, 60, 1.2, 1.4, true);
        this.ctx.bursts.burst(this.crate.group.position.clone(), C.good, 40, 1.0, 1.4, true);
        break;
      case 'restDone':
      case 'finished':
        break;
    }
  }

  /** Put fruit back on the branches for the next rep. */
  private refillBranches(): void {
    const n = this.game.level.fruit;
    this.fruits.forEach((f, i) => {
      if (i < n && (f.state === 'hidden' || (f.state === 'falling' && f.alpha <= 0.02))) {
        f.state = 'branch';
        f.alpha = 1;
      }
    });
  }

  // ---- Draw --------------------------------------------------------------

  render(dt: number, frame: RehabFrame | null, playing: boolean): void {
    const f = frame ?? this.lastFrame;
    const display = this.ctx.display;
    const base = this.ctx.base;
    const scale = f?.scale ?? 1;
    const form = this.game.form?.overall ?? 'good';

    // Fruit line ring at the target hip height.
    const ankleMid = f ? mid(f.pts[LM.lAnkle], f.pts[LM.rAnkle]) : { x: base.hipMid.x, y: base.hipMid.y + base.hipHeight };
    const targetPct = this.game.targetHipHeightPct();
    const targetY = display.toWorld({ x: base.hipMid.x, y: ankleMid.y - (targetPct / 100) * base.hipHeight * scale }).y;
    if (!this.ringYReady) {
      this.ringY = targetY;
      this.ringYReady = true;
    }
    const inZone = this.game.state === 'IN_ZONE' && this.game.measures !== null && this.game.inZone(this.game.measures.depth);
    const hip = this.hipWorld(f);
    // While in the zone the ring settles onto the real hip height.
    const ringTarget = inZone ? hip.y : targetY;
    this.ringY += (ringTarget - this.ringY) * (1 - Math.exp(-dt * 3));
    const depth = this.game.measures?.depth ?? 0;
    const near = depth >= this.game.zone[0] - 10;
    this.ringMat.color.set(inZone ? C.good : near && this.game.state !== 'READY' ? C.caution : C.grey);
    const hipW = Math.max(display.len(base.hipWidth), 0.22);
    this.ring.position.set(display.toWorld(base.hipMid).x, this.ringY, 0);
    this.ring.scale.setScalar(hipW * 1.15);

    // Branches level with the fruit line.
    const hx = display.toWorld(base.hipMid).x;
    this.branches.forEach((line, i) => {
      const s = i === 0 ? -1 : 1;
      const pts = [new THREE.Vector3(hx + s * 1.1, this.ringY + 0.12, -0.6), new THREE.Vector3(hx + s * 0.8, this.ringY + 0.02, -0.6), new THREE.Vector3(hx + s * 0.58, this.ringY - 0.02, -0.6)];
      (line.geometry as THREE.BufferGeometry).setFromPoints(pts);
    });

    // Basket on the hips.
    const width = Math.max(hipW * 1.4, 0.3);
    const load = this.fruits.filter((x) => x.state === 'basket').length;
    this.squash = Math.max(0, this.squash - dt * 4);
    const basketPos = hip.clone().add(new THREE.Vector3(0, -width * 0.25 - load * 0.006, 0));
    this.basket.group.position.copy(basketPos);
    this.basket.group.scale.set(width, width * (1 - 0.12 * this.squash), width);
    this.basket.rimMat.color.set(FORM_COLOUR[form]);

    // Crate high on the right, set back.
    const cratePos = this.worldAtDepth(display.width * 0.8, display.height * 0.16, coreConfig.render.layers.far);
    this.crate.group.position.copy(cratePos);
    this.crate.group.scale.setScalar(0.9);
    const filled = this.game.repsThisSet;
    this.crateGlow = Math.max(0, this.crateGlow - dt * 1.5);
    this.crate.slots.forEach((m, i) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(i < filled ? this.fruitColour : '#ffffff');
      mat.opacity = i < filled ? 0.85 : 0.08;
    });
    (this.crate.box.material as THREE.LineBasicMaterial).opacity = 0.6 + 0.4 * this.crateGlow;

    // Fruit.
    const radius = this.fruitRadius();
    if (this.game.state === 'READY' || this.game.state === 'LOWERING') this.refillBranches();
    let slot = 0;
    this.fruits.forEach((fr, i) => {
      fr.t += dt;
      switch (fr.state) {
        case 'branch':
          fr.pos.copy(this.branchSlot(i));
          fr.pos.y += Math.sin(performance.now() / 600 + i) * 0.006;
          break;
        case 'toBasket': {
          const k = Math.min(1, fr.t / 0.4);
          arc(fr.from, this.basketSlot(i, basketPos, width), k, 0.15, fr.pos);
          if (k >= 1) fr.state = 'basket';
          break;
        }
        case 'basket':
          fr.pos.copy(this.basketSlot(slot, basketPos, width));
          slot += 1;
          break;
        case 'toBranch': {
          const k = Math.min(1, fr.t / 0.5);
          arc(fr.from, this.branchSlot(i), k, 0.12, fr.pos);
          if (k >= 1) fr.state = 'branch';
          break;
        }
        case 'toCrate': {
          const k = Math.min(1, fr.t / 0.6);
          arc(fr.from, this.crateSlot(this.game.repsThisSet), k, 0.5, fr.pos);
          if (k >= 1) {
            fr.state = 'hidden';
            this.ctx.bursts.burst(fr.pos.clone(), this.fruitColour.getStyle(), 8, 0.3, 0.4);
          }
          break;
        }
        case 'falling':
          fr.vel.y -= 2.5 * dt;
          fr.pos.addScaledVector(fr.vel, dt);
          fr.alpha = Math.max(0, 1 - fr.t / squatConfig.spillFallSeconds);
          if (fr.alpha <= 0) fr.state = 'hidden';
          break;
        case 'hidden':
          break;
      }
      const visible = fr.state !== 'hidden';
      const s = visible ? radius * (fr.state === 'falling' ? 0.6 + 0.4 * fr.alpha : 1) : 0;
      this.mat4.compose(fr.pos, new THREE.Quaternion(), this.tmp.set(s, s, s));
      this.fruitMesh.setMatrixAt(i, this.mat4);
    });
    this.fruitMesh.instanceMatrix.needsUpdate = true;
    this.root.visible = playing || this.game.phase !== 'finished';
  }

  hud(): HudState {
    const g = this.game;
    const lv = levelsJson;
    let cue = g.cue ? { text: g.cue.text, tone: g.cue.tone } : null;
    let detail = `Set ${Math.min(g.set, lv.sets)}/${lv.sets}`;
    if (g.phase === 'rest') {
      const left = Math.max(0, Math.ceil(g.restUntil - (this.lastFrame?.t ?? 0)));
      detail = `Rest ${left}s`;
      cue = { text: 'Crate full! Rest', tone: 'good' };
    }
    return {
      levelName: `${this.levelDef.number} ${g.level.name}`,
      ring: 1 - g.attempts / g.totalReps,
      score: Math.round(g.score),
      combo: `Rep ${Math.min(lv.repsPerSet, g.repsThisSet + (g.phase === 'active' ? 1 : 0))}/${lv.repsPerSet}`,
      detail,
      cue,
    };
  }

  canUseHoverMenu(): boolean {
    return this.game.canUseHoverMenu();
  }

  isFinished(): boolean {
    return this.game.isFinished();
  }

  pause(): void {
    this.game.pause();
  }

  resume(): void {
    this.game.resume();
  }

  result(): ResultData {
    const g = this.game;
    const m = g.metrics(this.lastFrame?.t ?? 0);
    const unit = g.view === 'front' ? '%' : '°';
    return {
      stars: g.stars(),
      score: Math.round(g.score),
      numbers: [
        { label: 'Reps', value: `${g.repsDone}/${g.totalReps}` },
        { label: 'Spilled', value: String(g.spilledReps) },
        { label: 'Best depth', value: `${m.bestDepth}${unit}` },
        { label: 'Good form', value: `${m.formPct}%` },
      ],
      metrics: { ...m, faults: JSON.stringify(m.faults), sessionSeconds: Math.round(performance.now() / 1000 - this.startAt) },
    };
  }

  /** Scripted perfect reps for the mock skeleton. */
  demo(t: number): Partial<MockParams> {
    const lvl = this.game.level;
    const down = (lvl.tempoDown ?? 1.5) * 1.25;
    const hold = lvl.fruit * levelsJson.fruitIntervalSeconds + 0.6;
    const up = (lvl.tempoUp ?? 1.5) * 1.1;
    const top = levelsJson.emptySeconds + 1.2;
    const cycle = 1 + down + hold + up + top;
    const k = t % cycle;
    let p = 0;
    if (k < 1) p = 0;
    else if (k < 1 + down) p = (k - 1) / down;
    else if (k < 1 + down + hold) p = 1;
    else if (k < 1 + down + hold + up) p = 1 - (k - 1 - down - hold) / up;
    const target = (lvl.depth[0] + lvl.depth[1]) / 2;
    if (this.game.view === 'front') {
      return { view: 'front', hipDropPct: target * p, trunkLeanDeg: 0, kneeCaveDeg: 0, heelLiftPct: 0, toeOutDeg: 10, hipBackRatio: 0.45 };
    }
    const ranges = styleRanges(lvl, this.style);
    const theta = (target * p * Math.PI) / 180;
    const phi = (((ranges.shin[0] + ranges.shin[1]) / 2) * p * Math.PI) / 180;
    const T = MOCK_BODY.thigh;
    const S = MOCK_BODY.shin;
    const L = T + S;
    const hipUp = S * Math.cos(phi) + T * Math.cos(theta);
    const hipBack = T * Math.sin(theta) - S * Math.sin(phi);
    const drop = L - hipUp;
    return {
      view: 'side',
      hipDropPct: (100 * drop) / L,
      hipBackRatio: drop > 1e-4 ? hipBack / drop : 0.45,
      trunkLeanDeg: ((ranges.back[0] + ranges.back[1]) / 2) * p,
      kneeCaveDeg: 0,
      heelLiftPct: 0,
    };
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
  }
}

const STYLE_IDS = Object.keys(levelsJson.styles) as SquatStyleId[];

export const squatModule: GameModule = {
  id: 'squat',
  name: 'Fruit Catcher',
  icon: 'M6 10h12l-1.5 9h-9z M8 10a4 4 0 0 1 8 0 M12 3c1.5 0 2.5 1 2.5 2.5',
  requiredView: 'either',
  requiredLandmarks: squatConfig.requiredLandmarks,
  defaultOptions: { view: 'front', style: 'standard' },
  homeOptions: [
    { id: 'view', label: 'View', kind: 'tabs', choices: [{ id: 'front', label: 'Front' }, { id: 'side', label: 'Side' }] },
    {
      id: 'style',
      label: 'Style',
      kind: 'tabs',
      choices: STYLE_IDS.map((id) => ({ id, label: levelsJson.styles[id].name })),
      visible: (o) => o.view === 'side',
    },
  ],
  levels(options) {
    const view = (options.view === 'side' ? 'side' : 'front') as SquatView;
    const style = (options.style as SquatStyleId) ?? 'standard';
    return squatLevels(view).map((l, i) => ({
      id: l.id,
      number: i + 1,
      name: l.name,
      disabled: view === 'side' && !styleAllowsLevel(style, l.id),
    }));
  },
  levelKey: (level, options) => `${options.view === 'side' ? 'side' : 'front'}:${level.id}`,
  lastLevelKey: (options) => `squat:${options.view === 'side' ? 'side' : 'front'}`,
  requireReadyConfirm: () => false,
  normalizeOptions(options) {
    const view = options.view === 'side' ? 'side' : 'front';
    const style = typeof options.style === 'string' && options.style in levelsJson.styles ? options.style : 'standard';
    return { ...options, view, style };
  },
  createSession: (ctx, level, options) => new SquatSession(ctx, level, options),
};
