import * as THREE from 'three';
import coreConfig from '@vision/games/rehab/core/config.json';
import { LM, mid, type Side } from '@vision/games/rehab/core/geometry';
import { MOCK_ASPECT, type MockParams } from '@vision/games/rehab/core/mockSkeleton';
import type { BasePose, RehabFrame } from '@vision/games/rehab/core/types';
import bubblesConfig from '@vision/games/rehab/bubbles/config.json';
import {
  BUBBLE_LEVELS,
  bubbleLandmarks,
  CrossOverBubblesGame,
  RULES,
  roleFor,
  type Bubble,
  type BubbleEvent,
} from '@vision/games/rehab/bubbles/game';
import type { GameContext, GameModule, GameSession, HudState, LevelDef, OptionValues, ResultData } from '../core/module';
import { circleLine, polyline, setLinePoints, Trail } from '../core/render';

const C = coreConfig.colors;
const SIDE_COLOUR: Record<Side, string> = { left: C.left, right: C.right };

function bubbleColour(b: Bubble): string {
  if (b.kind === 'distractor') return C.grey;
  if (b.kind === 'gold') return C.caution;
  return b.colour === 'blue' ? C.left : C.right;
}

/** Fresnel rim: bright edge, faint inside, so the reflection shows through. */
function fresnelMaterial(hex: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(hex) }, uAlpha: { value: 1 } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.6);
        float a = (0.07 + rim) * uAlpha;
        gl_FragColor = vec4(uColor * (0.25 + rim * 1.4), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface BubbleView {
  group: THREE.Group;
  mat: THREE.ShaderMaterial;
  depth: number;
  phase: number;
}

interface Ring {
  line: THREE.LineLoop;
  t: number;
  pos: THREE.Vector3;
}

class BubblesSession implements GameSession {
  readonly requiredView = 'front' as const;
  readonly requiredLandmarks: number[];
  readonly seated: boolean;
  private readonly game: CrossOverBubblesGame;
  private readonly ctx: GameContext;
  private readonly root = new THREE.Group();
  private readonly views = new Map<number, BubbleView>();
  private readonly orbs: Record<Side, THREE.Group>;
  private readonly trails: Record<Side, Trail>;
  private readonly midline: THREE.Line;
  private readonly rings: Ring[] = [];
  private readonly level: LevelDef;
  private lastFrame: RehabFrame | null = null;
  private sphere = new THREE.SphereGeometry(1, 28, 18);
  private cone = new THREE.ConeGeometry(0.12, 0.3, 6);

  constructor(ctx: GameContext, level: LevelDef, options: OptionValues) {
    this.ctx = ctx;
    this.level = level;
    const def = BUBBLE_LEVELS.find((l) => l.id === level.id) ?? BUBBLE_LEVELS[0];
    this.seated = options.seated === true;
    this.game = new CrossOverBubblesGame(def, { seated: this.seated, foamPad: options.foamPad === true && def.march });
    this.requiredLandmarks = bubbleLandmarks(def, this.seated);

    this.orbs = { left: this.makeOrb('left'), right: this.makeOrb('right') };
    this.trails = { left: new Trail(C.left, 8), right: new Trail(C.right, 8) };
    this.root.add(this.trails.left.line, this.trails.right.line);
    this.midline = polyline([new THREE.Vector3(0, -1, -0.1), new THREE.Vector3(0, 1, -0.1)], '#ffffff', 0.18, true);
    this.midline.visible = def.midlineHint;
    this.root.add(this.midline);
    ctx.scene.add(this.root);
  }

  private makeOrb(side: Side): THREE.Group {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: SIDE_COLOUR[side], transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.setScalar(0.35);
    g.add(core);
    g.add(circleLine(1, SIDE_COLOUR[side], 40, 0.9));
    this.root.add(g);
    return g;
  }

  private makeBubble(b: Bubble): BubbleView {
    const group = new THREE.Group();
    const hex = bubbleColour(b);
    const mat = fresnelMaterial(hex);
    group.add(new THREE.Mesh(this.sphere, mat));
    if (b.kind === 'distractor') {
      const spikeMat = new THREE.MeshBasicMaterial({ color: C.grey, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
      const dirs = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0.7, -0.7, 0], [-0.7, -0.7, 0],
      ];
      for (const [x, y, z] of dirs) {
        const c = new THREE.Mesh(this.cone, spikeMat);
        const d = new THREE.Vector3(x, y, z).normalize();
        c.position.copy(d.clone().multiplyScalar(1.05));
        c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        group.add(c);
      }
    }
    if (b.kind === 'gold') {
      // Inner ring in the colour of the hand rule that applies to it.
      group.add(circleLine(0.45, b.colour === 'blue' ? C.left : C.right, 32, 0.9));
    }
    this.root.add(group);
    const view = { group, mat, depth: (Math.random() - 0.5) * 1.0, phase: Math.random() * Math.PI * 2 };
    this.views.set(b.id, view);
    return view;
  }

  private worldOnRay(sx: number, sy: number, z: number): { pos: THREE.Vector3; k: number } {
    const v = this.ctx.display.screenToWorld(sx, sy);
    const cam = this.ctx.camera.position;
    const k = (cam.z - z) / cam.z;
    return { pos: new THREE.Vector3(v.x * k, cam.y + (v.y - cam.y) * k, z), k };
  }

  pause(): void {
    this.game.pause();
  }

  resume(): void {
    this.game.resume();
  }

  update(_dt: number, frame: RehabFrame, base: BasePose): void {
    this.lastFrame = frame;
    // The portrait screen shows less than the patient can reach: spawn only where it is seen.
    this.game.visible = this.ctx.display.visibleImageBounds();
    const events = this.game.update(frame, base);
    for (const e of events) this.onEvent(e);
  }

  private onEvent(e: BubbleEvent): void {
    const audio = this.ctx.audio;
    const display = this.ctx.display;
    switch (e.type) {
      case 'spawn':
        this.makeBubble(e.bubble);
        break;
      case 'pop': {
        audio.pop(e.hand === 'left' ? 0.15 : 0.85);
        const pos = display.toWorld(e.bubble);
        this.ctx.bursts.burst(pos, bubbleColour(e.bubble), 20, 0.7, 0.6);
        this.addRing(pos, bubbleColour(e.bubble));
        break;
      }
      case 'wrongHand':
        audio.buzz();
        break;
      case 'distractor': {
        audio.lowTone();
        const pos = display.toWorld(e.bubble);
        this.ctx.bursts.burst(pos, C.grey, 24, 0.6, 0.6);
        break;
      }
      case 'ruleAnnounce':
      case 'ruleChange':
        audio.chime();
        break;
      case 'missed':
      case 'finished':
        break;
    }
  }

  private addRing(pos: THREE.Vector3, hex: string): void {
    const line = circleLine(1, hex, 48, 0.9);
    line.position.copy(pos);
    line.scale.setScalar(0.05);
    this.root.add(line);
    this.rings.push({ line, t: 0, pos });
  }

  render(dt: number, frame: RehabFrame | null): void {
    const display = this.ctx.display;
    const f = frame ?? this.lastFrame;
    const now = performance.now() / 1000;
    const arm = this.game.zone?.arm ?? this.ctx.base.armLength;

    // Bubbles.
    const live = new Set<number>();
    for (const b of this.game.bubbles) {
      live.add(b.id);
      const v = this.views.get(b.id) ?? this.makeBubble(b);
      const shake = now < b.shakeUntil ? Math.sin(now * 60) * b.radius * 0.15 : 0;
      const s = display.toScreen({ x: b.x + shake, y: b.y + Math.sin(now * 1.6 + v.phase) * b.radius * 0.08 });
      const { pos, k } = this.worldOnRay(s.x, s.y, v.depth);
      v.group.position.copy(pos);
      v.group.scale.setScalar(display.len(b.radius) * k);
      v.group.rotation.z += dt * 0.3;
      let alpha = Math.min(1, b.age / 0.3);
      if (b.endedAt !== null) {
        const fade = 1 - (this.game.bubbleClock - b.endedAt) / bubblesConfig.fadeSeconds;
        alpha = b.popped ? 0 : Math.max(0, fade);
      } else if (b.age > b.lifetime - 1) {
        alpha *= Math.max(0.2, b.lifetime - b.age);
      }
      v.mat.uniforms.uAlpha.value = alpha;
      v.group.visible = alpha > 0.01;
    }
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      this.root.remove(v.group);
      v.mat.dispose();
      this.views.delete(id);
    }

    // Hands.
    const handR = display.len(bubblesConfig.handRadius * arm);
    for (const side of ['left', 'right'] as Side[]) {
      const h = this.game.hands[side];
      const orb = this.orbs[side];
      if (!h) {
        orb.visible = false;
        this.trails[side].push(null);
        continue;
      }
      const p = display.toWorld(h.p, 0.05);
      orb.visible = true;
      orb.position.copy(p);
      orb.scale.setScalar(handR);
      this.trails[side].push(p);
    }

    // Midline hint.
    if (this.midline.visible && f) {
      const p = f.pts;
      const top = display.toWorld({ x: this.game.midX, y: mid(p[LM.lShoulder], p[LM.rShoulder]).y - 0.15 });
      const bottom = display.toWorld({ x: this.game.midX, y: mid(p[LM.lHip], p[LM.rHip]).y + 0.05 });
      setLinePoints(this.midline, [new THREE.Vector3(top.x, top.y, -0.1), new THREE.Vector3(bottom.x, bottom.y, -0.1)]);
    }

    // Pop rings.
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.45;
      r.line.scale.setScalar(0.05 + k * 0.25);
      (r.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) {
        this.root.remove(r.line);
        r.line.geometry.dispose();
        (r.line.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  hud(): HudState {
    const g = this.game;
    const sc = bubblesConfig.score;
    const mult = Math.min(sc.comboMax, 1 + Math.floor(g.streak / sc.comboEvery));
    return {
      levelName: `${this.level.number} ${g.level.name}`,
      ring: Math.max(0, 1 - g.elapsed / g.roundSeconds),
      score: g.score,
      combo: `x${mult}`,
      cue: g.cue ? { text: g.cue.text, tone: 'caution' } : null,
      ruleCard: {
        text: g.ruleText(),
        next: g.ruleAnnounce ? `Next: ${RULES[g.ruleAnnounce].text}` : null,
        pulse: g.ruleAnnounce !== null,
      },
    };
  }

  canUseHoverMenu(): boolean {
    return this.game.canUseHoverMenu();
  }

  isFinished(): boolean {
    return this.game.isFinished();
  }

  result(): ResultData {
    const g = this.game;
    const m = g.metrics();
    const meanRt = [m.reactionMeanLeft, m.reactionMeanRight].filter((v): v is number => v !== null);
    return {
      stars: g.stars(),
      score: g.score,
      numbers: [
        { label: 'Popped', value: `${Math.round(g.correctPct())}%` },
        { label: 'Wrong hand', value: String(m.wrongHandTouches) },
        { label: 'Reaction', value: meanRt.length ? `${(meanRt.reduce((a, b) => a + b, 0) / meanRt.length).toFixed(2)} s` : '–' },
        { label: 'Cross-overs', value: String(m.crossingPops) },
      ],
      metrics: { ...m },
    };
  }

  /** Mock demo: each hand reaches for the bubbles it should pop; level 5 also marches. */
  demo(t: number): Partial<MockParams> {
    const g = this.game;
    const target = (side: Side) => {
      const mine = g.bubbles.filter((b) => b.endedAt === null && b.age > 1.0 && roleFor(g.rule, b.colour, b.kind) === side);
      mine.sort((a, b) => b.age - a.age);
      const b = mine[0];
      return b ? { x: b.x / MOCK_ASPECT, y: b.y } : null;
    };
    const out: Partial<MockParams> = { leftWrist: target('left'), rightWrist: target('right'), view: 'front', hipDropPct: 0, trunkLeanDeg: 0 };
    if (g.level.march) {
      const phase = (t % 1.2) / 1.2;
      out.leftFootLift = phase < 0.5 ? Math.sin(phase * 2 * Math.PI) * 16 : 0;
      out.rightFootLift = phase >= 0.5 ? Math.sin((phase - 0.5) * 2 * Math.PI) * 16 : 0;
    }
    return out;
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.sphere && m.geometry !== this.cone) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
    this.sphere.dispose();
    this.cone.dispose();
  }
}

export const bubblesModule: GameModule = {
  id: 'bubbles',
  name: 'Cross-Over Bubbles',
  icon: 'M8 14a4 4 0 1 0 0.01 0 M16 7a3 3 0 1 0 0.01 0 M17 16a2 2 0 1 0 0.01 0',
  requiredView: 'front',
  requiredLandmarks: bubblesConfig.requiredLandmarks,
  defaultOptions: { seated: false, foamPad: false },
  homeOptions: [
    { id: 'seated', label: 'Seated', kind: 'toggle' },
    { id: 'foamPad', label: 'Foam pad', kind: 'toggle', visible: (_o, levelIndex) => levelIndex === 4 },
  ],
  levels: () => BUBBLE_LEVELS.map((l, i) => ({ id: l.id, number: i + 1, name: l.name })),
  levelKey: (level) => level.id,
  lastLevelKey: () => 'bubbles',
  requireReadyConfirm: (level) => (BUBBLE_LEVELS.find((l) => l.id === level.id)?.march ?? false),
  landmarksFor: (level, options) => bubbleLandmarks(BUBBLE_LEVELS.find((l) => l.id === level.id) ?? BUBBLE_LEVELS[0], options.seated === true),
  seatedFor: (options) => options.seated === true,
  createSession: (ctx, level, options) => new BubblesSession(ctx, level, options),
};
