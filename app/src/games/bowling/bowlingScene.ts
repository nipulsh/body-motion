import * as THREE from 'three';
import {
  BALL,
  BALL_RELEASE_Z,
  HEAD_PIN_Z,
  LANE,
  PIN_PROFILE,
  PIT_EDGE_Z,
  pinRadiusAt,
} from './bowlingDimensions';
import type { BowlingSnapshot } from './bowlingPhysics';

const INCH = 0.0254;
const FOOT = 12 * INCH;

/** Camera behind the bowler, a little above eye level, aimed down the lane. */
const CAMERA_AIM = { y: 1.7, z: 3.0, lookY: 0, lookZ: -9 };
/** While the ball rolls the camera follows it, stopping short of the pins to watch them fall. */
const CAMERA_FOLLOW_OFFSET = 2.6;
const CAMERA_STOP_Z = HEAD_PIN_Z + 5.5;
const CAMERA_FOLLOW_Y = 1.15;

export type BowlingCameraMode = 'aim' | 'follow';

function boardTexture(): THREE.CanvasTexture {
  const w = LANE.boards * 8;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let b = 0; b < LANE.boards; b += 1) {
      const tone = 196 + ((b * 37) % 5) * 6;
      ctx.fillStyle = `rgb(${tone}, ${Math.round(tone * 0.78)}, ${Math.round(tone * 0.52)})`;
      ctx.fillRect(b * 8, 0, 8, h);
      ctx.fillStyle = 'rgba(80, 50, 20, 0.35)';
      ctx.fillRect(b * 8, 0, 1, h);
    }
    // Faint grain so speed reads as the ball passes over the boards.
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = `rgba(90, 55, 25, ${0.04 + ((i * 13) % 7) * 0.012})`;
      const x = (i * 97) % w;
      const y = (i * 211) % h;
      ctx.fillRect(x, y, 1, 6 + ((i * 7) % 18));
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** x of a board centre, counting boards from the bowler's right edge (board 1). */
function boardX(board: number): number {
  const boardW = LANE.width / LANE.boards;
  return LANE.halfWidth - (board - 0.5) * boardW;
}

function gutterGeometry(side: -1 | 1, length: number, zCenter: number): THREE.BufferGeometry {
  const gw = LANE.gutterWidth;
  const depth = LANE.gutterDepth;
  const arcR = (gw / 2) ** 2 / (2 * depth) + depth / 2;
  const arcCy = arcR - depth;
  const cx = side * (LANE.halfWidth + gw / 2);
  const steps = 12;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const z0 = zCenter + length / 2;
  const z1 = zCenter - length / 2;
  for (let i = 0; i <= steps; i += 1) {
    const u = -gw / 2 + (gw * i) / steps;
    const y = arcCy - Math.sqrt(arcR * arcR - u * u);
    const nx = -u / arcR;
    const ny = (arcCy - y) / arcR;
    positions.push(cx + u, y, z0, cx + u, y, z1);
    normals.push(nx, ny, 0, nx, ny, 0);
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

function arrowGeometry(): THREE.BufferGeometry {
  const w = 0.025;
  const l = 0.16;
  const shape = new THREE.Shape();
  shape.moveTo(0, l / 2);
  shape.lineTo(w / 2, -l / 2);
  shape.lineTo(-w / 2, -l / 2);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function pinGeometry(): THREE.LatheGeometry {
  const pts = PIN_PROFILE.map((p) => new THREE.Vector2(Math.max(p.r, 0.0001), p.h));
  return new THREE.LatheGeometry(pts, 28);
}

function stripeGeometry(fromH: number, toH: number): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(
    pinRadiusAt(toH) * 1.004,
    pinRadiusAt(fromH) * 1.004,
    toH - fromH,
    28,
    1,
    true,
  );
  geo.translate(0, (fromH + toH) / 2, 0);
  return geo;
}

function ballMesh(): THREE.Group {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(BALL.radius, 40, 28),
    new THREE.MeshStandardMaterial({ color: 0x2456c9, roughness: 0.22, metalness: 0.15 }),
  );
  sphere.castShadow = true;
  group.add(sphere);
  // Finger and thumb holes make the roll visible.
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x05070d });
  const holes: Array<[number, number, number]> = [
    [-0.022, 0.05, 0.0125],
    [0.022, 0.05, 0.0125],
    [0, -0.045, 0.0145],
  ];
  for (const [ax, ay, r] of holes) {
    const dir = new THREE.Vector3(ax, ay, 1).normalize();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 20), holeMat);
    disc.position.copy(dir.clone().multiplyScalar(BALL.radius * 1.002));
    disc.lookAt(dir.clone().multiplyScalar(BALL.radius * 2));
    group.add(disc);
  }
  return group;
}

/**
 * three.js view of the lane on a black background: lane, gutters, arrows and dots,
 * pins and ball. Nothing else is drawn.
 */
export class BowlingScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ball: THREE.Group;
  private readonly pins: THREE.Group[] = [];
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly camPos = new THREE.Vector3(0, CAMERA_AIM.y, CAMERA_AIM.z);
  private readonly camLook = new THREE.Vector3(0, CAMERA_AIM.lookY, CAMERA_AIM.lookZ);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(50, 9 / 16, 0.05, 60);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    this.buildLights();
    this.buildLane();
    this.ball = ballMesh();
    this.scene.add(this.ball);
    this.buildPins();
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a1208, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 6, -4);
    key.target.position.set(0, 0, -10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -1.2;
    cam.right = 1.2;
    cam.top = 11;
    cam.bottom = -11;
    cam.near = 0.5;
    cam.far = 20;
    key.shadow.bias = -0.0005;
    this.scene.add(key, key.target);
    // A light over the pin deck, like the lane's masking-unit lights.
    const deck = new THREE.PointLight(0xffffff, 6, 7, 1.6);
    deck.position.set(0, 2.2, HEAD_PIN_Z + 1.5);
    this.scene.add(deck);
  }

  private buildLane(): void {
    const start = 0;
    const length = start - PIT_EDGE_Z;
    const zCenter = start - length / 2;

    const tex = this.track(boardTexture());
    tex.repeat.set(1, length / 1.6);
    const laneMat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.0 }));
    const laneGeo = this.track(new THREE.PlaneGeometry(LANE.width, length));
    laneGeo.rotateX(-Math.PI / 2);
    const lane = new THREE.Mesh(laneGeo, laneMat);
    lane.position.set(0, 0, zCenter);
    lane.receiveShadow = true;
    this.scene.add(lane);

    const gutterMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }),
    );
    for (const side of [-1, 1] as const) {
      const g = new THREE.Mesh(this.track(gutterGeometry(side, length, zCenter)), gutterMat);
      g.receiveShadow = true;
      this.scene.add(g);
    }

    const markMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0x5a2d12,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );

    // Foul line.
    const foulGeo = this.track(new THREE.PlaneGeometry(LANE.width, 0.012));
    foulGeo.rotateX(-Math.PI / 2);
    const foul = new THREE.Mesh(foulGeo, markMat);
    foul.position.set(0, 0.0005, 0);
    this.scene.add(foul);

    // Targeting arrows on boards 5..35 in a V, the centre arrow furthest out.
    const arrowGeo = this.track(arrowGeometry());
    const arrowBoards = [5, 10, 15, 20, 25, 30, 35];
    for (const board of arrowBoards) {
      const step = Math.abs(board - 20) / 5;
      const dist = 16 * FOOT - step * FOOT;
      const arrow = new THREE.Mesh(arrowGeo, markMat);
      arrow.position.set(boardX(board), 0.0005, -dist);
      this.scene.add(arrow);
    }

    // Guide dots 7 ft past the foul line.
    const dotGeo = this.track(new THREE.CircleGeometry(0.009, 16));
    dotGeo.rotateX(-Math.PI / 2);
    for (const board of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
      const dot = new THREE.Mesh(dotGeo, markMat);
      dot.position.set(boardX(board), 0.0005, -7 * FOOT);
      this.scene.add(dot);
    }
  }

  private buildPins(): void {
    const body = this.track(pinGeometry());
    const pinMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.28, metalness: 0.0 }));
    const stripeMat = this.track(new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.3 }));
    const stripeA = this.track(stripeGeometry(8.75 * INCH, 9.1 * INCH));
    const stripeB = this.track(stripeGeometry(9.45 * INCH, 9.8 * INCH));
    for (let i = 0; i < 10; i += 1) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(body, pinMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh, new THREE.Mesh(stripeA, stripeMat), new THREE.Mesh(stripeB, stripeMat));
      this.pins.push(group);
      this.scene.add(group);
    }
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(2, Math.max(1, pixelRatio)));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Draws one frame. `aimBallX` shows the ball at the foul line before the throw;
   * pass null once the physics ball is in play.
   */
  render(snapshot: BowlingSnapshot, aimBallX: number | null, mode: BowlingCameraMode, dtSeconds: number): void {
    if (aimBallX !== null) {
      this.ball.visible = true;
      this.ball.position.set(aimBallX, BALL.radius, BALL_RELEASE_Z);
      this.ball.quaternion.identity();
    } else {
      const b = snapshot.ball;
      this.ball.visible = b.inPlay && b.y > -0.12;
      this.ball.position.set(b.x, b.y, b.z);
      this.ball.quaternion.set(b.qx, b.qy, b.qz, b.qw);
    }

    snapshot.pins.forEach((p, i) => {
      const mesh = this.pins[i];
      if (!mesh) return;
      // Pins that drop into the pit fall out of sight into the black.
      mesh.visible = p.inPlay && p.y > -0.12;
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    });

    this.updateCamera(snapshot, aimBallX, mode, dtSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(
    snapshot: BowlingSnapshot,
    aimBallX: number | null,
    mode: BowlingCameraMode,
    dtSeconds: number,
  ): void {
    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    if (mode === 'follow' && aimBallX === null && snapshot.ball.inPlay) {
      const z = Math.max(CAMERA_STOP_Z, Math.min(CAMERA_AIM.z, snapshot.ball.z + CAMERA_FOLLOW_OFFSET));
      targetPos.set(0, CAMERA_FOLLOW_Y, z);
      targetLook.set(0, 0, HEAD_PIN_Z - 0.3);
    } else if (mode === 'follow') {
      // Ball gone into the pit: hold on the pins.
      targetPos.set(0, CAMERA_FOLLOW_Y, CAMERA_STOP_Z);
      targetLook.set(0, 0, HEAD_PIN_Z - 0.3);
    } else {
      targetPos.set(0, CAMERA_AIM.y, CAMERA_AIM.z);
      targetLook.set(0, CAMERA_AIM.lookY, CAMERA_AIM.lookZ);
    }
    const k = 1 - Math.exp(-Math.max(0, Math.min(0.1, dtSeconds)) * (mode === 'follow' ? 6 : 2.5));
    this.camPos.lerp(targetPos, k);
    this.camLook.lerp(targetLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  dispose(): void {
    this.ball.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}
