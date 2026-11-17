import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import coreConfig from '@vision/games/rehab/core/config.json';
import type { DisplayMapper } from './display';

export const LAYER_Z = coreConfig.render.layers;

/**
 * Black-mirror Three.js stage: pure black clear colour, a perspective camera
 * whose z = 0 plane matches the display mapping, optional bloom.
 */
export class RehabRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private horizonY = 0;
  private size = { w: 1, h: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(coreConfig.render.fovDeg, 1, 0.05, 100);
    this.scene.background = new THREE.Color(0x000000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(0.5, 1, 2);
    this.scene.add(key);
    if (coreConfig.render.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.4, 0.2));
    }
  }

  /** World y the perspective vanishes toward (eye level looks natural). */
  setHorizon(y: number): void {
    this.horizonY = y;
  }

  /** Size the canvas and place the camera so world z = 0 lines up with the display mapping. */
  layout(display: DisplayMapper, dpr: number): void {
    const w = display.width;
    const h = display.height;
    if (w !== this.size.w || h !== this.size.h || this.renderer.getPixelRatio() !== dpr) {
      this.size = { w, h };
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.setSize(w, h, false);
      this.composer?.setSize(w, h);
    }
    const d = display.cameraDistance(coreConfig.render.fovDeg);
    const shiftPx = this.horizonY * display.pxPerWorld;
    const fullH = h + 2 * Math.abs(shiftPx);
    const fullWorld = fullH / display.pxPerWorld;
    this.camera.fov = (2 * Math.atan(fullWorld / 2 / d) * 180) / Math.PI;
    this.camera.aspect = w / fullH;
    this.camera.position.set(0, this.horizonY, d);
    this.camera.lookAt(0, this.horizonY, 0);
    // Sub-window of the taller virtual view, so world y = 0 stays at the screen centre.
    const offsetY = shiftPx > 0 ? 2 * shiftPx : 0;
    if (Math.abs(shiftPx) > 0.5) this.camera.setViewOffset(w, fullH, 0, offsetY, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

// ---- Helpers ---------------------------------------------------------------

export function color(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** Additive line material: reads as a glow on black and leaves dark pixels dark. */
export function glowLineMaterial(hex: string, opacity = 1): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

export function glowMeshMaterial(hex: string, opacity = 0.25): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

/** Outline of a geometry's hard edges. */
export function outline(geometry: THREE.BufferGeometry, hex: string, opacity = 1, threshold = 20): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geometry, threshold), glowLineMaterial(hex, opacity));
}

export function circleLine(radius: number, hex: string, segments = 64, opacity = 1): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), glowLineMaterial(hex, opacity));
}

export function polyline(points: THREE.Vector3[], hex: string, opacity = 1, dashed = false): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  if (!dashed) return new THREE.Line(geo, glowLineMaterial(hex, opacity));
  const mat = new THREE.LineDashedMaterial({ color: hex, dashSize: 0.05, gapSize: 0.05, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  return line;
}

export function setLinePoints(line: THREE.Line, points: THREE.Vector3[]): void {
  const geo = line.geometry as THREE.BufferGeometry;
  const attr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (attr && attr.count === points.length) {
    points.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
    attr.needsUpdate = true;
    geo.computeBoundingSphere();
  } else {
    // A different point count needs a new buffer (setFromPoints cannot grow one in place).
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
    geo.computeBoundingSphere();
  }
  if ((line.material as THREE.Material).type === 'LineDashedMaterial') line.computeLineDistances();
}

/** Text sprite drawn on a canvas texture (white or tinted, no background). */
export function textSprite(text: string, hex = '#ffffff', heightWorld = 0.08): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = 96;
  canvas.height = 128;
  if (ctx) {
    ctx.font = `600 ${font}px system-ui, sans-serif`;
    canvas.width = Math.max(64, Math.ceil(ctx.measureText(text).width + 24));
    ctx.font = `600 ${font}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = hex;
    ctx.shadowBlur = 16;
    ctx.fillStyle = hex;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((heightWorld * canvas.width) / canvas.height, heightWorld, 1);
  return sprite;
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
}

/** Additive point bursts (pops, confetti, sparks) with simple gravity and fade. */
export class Bursts {
  readonly object: THREE.Points;
  private readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly tints: THREE.Color[] = [];
  private readonly capacity: number;

  constructor(capacity = 600, size = 0.03) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    this.object = new THREE.Points(geo, mat);
    this.object.frustumCulled = false;
  }

  burst(at: THREE.Vector3, hex: string, count = 20, speed = 0.6, life = 0.7, gravity = false): void {
    const c = new THREE.Color(hex);
    for (let i = 0; i < count && this.particles.length < this.capacity; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * Math.PI;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        pos: at.clone(),
        vel: new THREE.Vector3(Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + (gravity ? v * 0.8 : 0), Math.sin(a) * Math.cos(e) * v * 0.3),
        life: life * (0.6 + Math.random() * 0.4),
        max: life,
      });
      this.tints.push(c);
    }
  }

  update(dt: number, gravity = 0): void {
    let n = 0;
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      const f = Math.max(0, p.life / p.max);
      const c = this.tints[i];
      this.particles[n] = p;
      this.tints[n] = c;
      this.positions.set([p.pos.x, p.pos.y, p.pos.z], n * 3);
      this.colors.set([c.r * f, c.g * f, c.b * f], n * 3);
      n += 1;
    }
    this.particles.length = n;
    this.tints.length = n;
    const geo = this.object.geometry as THREE.BufferGeometry;
    geo.setDrawRange(0, n);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Short fading trail behind a moving point (hand and foot orbs). */
export class Trail {
  readonly line: THREE.Line;
  private readonly pts: THREE.Vector3[] = [];
  constructor(
    hex: string,
    private readonly length = 10,
  ) {
    this.line = polyline([new THREE.Vector3(), new THREE.Vector3()], hex, 0.6);
  }
  push(p: THREE.Vector3 | null): void {
    if (!p) {
      this.pts.length = 0;
      this.line.visible = false;
      return;
    }
    this.pts.push(p.clone());
    if (this.pts.length > this.length) this.pts.shift();
    this.line.visible = this.pts.length > 1;
    if (this.pts.length > 1) setLinePoints(this.line, this.pts);
  }
}
