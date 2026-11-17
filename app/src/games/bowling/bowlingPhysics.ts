import RAPIER from '@dimforge/rapier3d-compat';
import {
  BALL,
  BALL_RELEASE_Z,
  HEAD_PIN_Z,
  LANE,
  OIL_END_Z,
  PIN,
  PIN_PROFILE,
  PIN_SPOTS,
  PIT_EDGE_Z,
} from './bowlingDimensions';

type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

/** Loads the Rapier WASM module once per app session. */
export function loadRapier(): Promise<Rapier> {
  if (!rapierReady) {
    rapierReady = RAPIER.init().then(
      () => RAPIER,
      (err: unknown) => {
        rapierReady = null;
        throw err;
      },
    );
  }
  return rapierReady;
}

/**
 * Surface behaviour. Friction on the lane is set by the lane (Min combine), so the
 * oiled front skids and the dry back end grips, as on a real lane.
 */
export const SURFACE = {
  oilFriction: 0.04,
  dryFriction: 0.2,
  gutterFriction: 0.1,
  pinFriction: 0.25,
  ballRestitution: 0.75,
  pinRestitution: 0.55,
  kickbackRestitution: 0.4,
  pitFriction: 0.6,
  pitRestitution: 0.1,
  /** Rolling losses and air drag on a fallen, rolling pin. */
  pinLinearDamping: 0.1,
  pinAngularDamping: 0.4,
} as const;

const FIXED_DT = 1 / 240;
const MAX_STEPS_PER_FRAME = 12;
const PIN_SEGMENTS = 12;
const STANDING_MAX_TILT_RAD = (25 * Math.PI) / 180;

export interface BodyPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface BowlingSnapshot {
  ball: BodyPose & { inPlay: boolean };
  pins: Array<BodyPose & { inPlay: boolean }>;
}

export interface LaunchParams {
  /** Lane x at release, meters. */
  x: number;
  /** m/s along the direction of travel. */
  speed: number;
  /** Radians from straight down the lane, + toward the bowler's right. */
  angle: number;
}

function poseOf(body: RAPIER.RigidBody): BodyPose {
  const t = body.translation();
  const q = body.rotation();
  return { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
}

function frustumVolume(h: number, r1: number, r2: number): number {
  return (Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
}

function profileVolume(fromH: number, toH: number): number {
  let v = 0;
  for (let i = 1; i < PIN_PROFILE.length; i += 1) {
    const a = PIN_PROFILE[i - 1];
    const b = PIN_PROFILE[i];
    if (b.h <= fromH || a.h >= toH) continue;
    v += frustumVolume(b.h - a.h, a.r, b.r);
  }
  return v;
}

function latheHullPoints(fromH: number, toH: number): Float32Array {
  const ring = PIN_PROFILE.filter((p) => p.h >= fromH - 1e-9 && p.h <= toH + 1e-9);
  const pts: number[] = [];
  for (const p of ring) {
    if (p.r < 1e-6) {
      pts.push(0, p.h, 0);
      continue;
    }
    for (let k = 0; k < PIN_SEGMENTS; k += 1) {
      const a = (k / PIN_SEGMENTS) * Math.PI * 2;
      pts.push(Math.cos(a) * p.r, p.h, Math.sin(a) * p.r);
    }
  }
  return new Float32Array(pts);
}

function zRotation(angle: number) {
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

/**
 * Rapier world for one lane: ball, ten pins, lane (oiled then dry), concave gutters,
 * kickbacks and the pit. Steps at a fixed 240 Hz.
 */
export class BowlingPhysics {
  private readonly R: Rapier;
  private readonly world: RAPIER.World;
  private readonly ball: RAPIER.RigidBody;
  private readonly pins: RAPIER.RigidBody[] = [];
  private accumulator = 0;
  private disposed = false;

  static async create(): Promise<BowlingPhysics> {
    const R = await loadRapier();
    return new BowlingPhysics(R);
  }

  private constructor(R: Rapier) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.numSolverIterations = 8;

    this.buildLane();
    this.ball = this.buildBall();
    for (let i = 0; i < PIN_SPOTS.length; i += 1) this.pins.push(this.buildPin());
    this.rackPins();
    this.holdBall();
  }

  private fixed(desc: RAPIER.ColliderDesc): void {
    this.world.createCollider(desc);
  }

  private buildLane(): void {
    const R = this.R;
    const { Min } = R.CoefficientCombineRule;
    const halfW = LANE.halfWidth;
    const laneStart = 1.0;

    const box = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
      R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);

    // Oiled front, then dry back end through the pin deck. Top surface at y = 0.
    const oilLen = laneStart - OIL_END_Z;
    this.fixed(
      box(halfW, 0.05, oilLen / 2, 0, -0.05, laneStart - oilLen / 2)
        .setFriction(SURFACE.oilFriction)
        .setFrictionCombineRule(Min)
        .setRestitution(0)
        .setRestitutionCombineRule(Min),
    );
    const dryLen = OIL_END_Z - PIT_EDGE_Z;
    this.fixed(
      box(halfW, 0.05, dryLen / 2, 0, -0.05, OIL_END_Z - dryLen / 2)
        .setFriction(SURFACE.dryFriction)
        .setFrictionCombineRule(Min)
        .setRestitution(0)
        .setRestitutionCombineRule(Min),
    );

    // Concave gutters: a circular arc through both gutter edges, built from thin boxes.
    const gw = LANE.gutterWidth;
    const depth = LANE.gutterDepth;
    const arcR = (gw / 2) ** 2 / (2 * depth) + depth / 2;
    const arcCy = arcR - depth;
    const segments = 8;
    const gutterLen = laneStart - PIT_EDGE_Z;
    const gutterZ = laneStart - gutterLen / 2;
    const thickness = 0.01;
    for (const side of [-1, 1]) {
      const cx = side * (halfW + gw / 2);
      for (let i = 0; i < segments; i += 1) {
        const u1 = -gw / 2 + (gw * i) / segments;
        const u2 = -gw / 2 + (gw * (i + 1)) / segments;
        const y1 = arcCy - Math.sqrt(arcR * arcR - u1 * u1);
        const y2 = arcCy - Math.sqrt(arcR * arcR - u2 * u2);
        const ang = Math.atan2(y2 - y1, u2 - u1);
        const len = Math.hypot(u2 - u1, y2 - y1);
        const mx = cx + (u1 + u2) / 2 + Math.sin(ang) * (thickness / 2);
        const my = (y1 + y2) / 2 - Math.cos(ang) * (thickness / 2);
        this.fixed(
          R.ColliderDesc.cuboid(len / 2 + 0.002, thickness / 2, gutterLen / 2)
            .setTranslation(mx, my, gutterZ)
            .setRotation(zRotation(ang))
            .setFriction(SURFACE.gutterFriction)
            .setFrictionCombineRule(Min)
            .setRestitution(0)
            .setRestitutionCombineRule(Min),
        );
      }

      // Capping beyond each gutter keeps a gutter ball in its channel.
      this.fixed(box(0.03, 0.06, gutterLen / 2, side * (halfW + gw + 0.03), 0.02, gutterZ));

      // Kickbacks: side walls along the pin deck that bounce pins back across it.
      const kbStart = HEAD_PIN_Z + 0.9;
      const kbEnd = PIT_EDGE_Z - 1.2;
      const kbLen = kbStart - kbEnd;
      this.fixed(
        box(0.03, 0.4, kbLen / 2, side * (LANE.kickbackSpan / 2 + 0.03), 0.35, kbStart - kbLen / 2)
          .setRestitution(SURFACE.kickbackRestitution)
          .setFriction(0.3),
      );
    }

    // Pit below and behind the pin deck, with a soft cushion at the back.
    const pitDepth = 0.3;
    const pitLen = 1.2;
    const pitHalfW = LANE.kickbackSpan / 2;
    const pit = (desc: RAPIER.ColliderDesc) =>
      desc
        .setFriction(SURFACE.pitFriction)
        .setFrictionCombineRule(Min)
        .setRestitution(SURFACE.pitRestitution)
        .setRestitutionCombineRule(Min);
    this.fixed(pit(box(pitHalfW, 0.05, pitLen / 2, 0, -pitDepth - 0.05, PIT_EDGE_Z - pitLen / 2)));
    this.fixed(pit(box(pitHalfW, 0.6, 0.05, 0, 0.3 - pitDepth, PIT_EDGE_Z - pitLen)));
  }

  private buildBall(): RAPIER.RigidBody {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(true),
    );
    this.world.createCollider(
      R.ColliderDesc.ball(BALL.radius)
        .setMass(BALL.mass)
        // Neutral: lane and pin colliders set the contact friction (Min combine).
        .setFriction(1)
        .setRestitution(SURFACE.ballRestitution),
      body,
    );
    return body;
  }

  private buildPin(): RAPIER.RigidBody {
    const R = this.R;
    const { Min } = R.CoefficientCombineRule;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setCcdEnabled(true)
        .setCanSleep(true)
        .setLinearDamping(SURFACE.pinLinearDamping)
        .setAngularDamping(SURFACE.pinAngularDamping),
    );
    // Two convex hulls (body to neck, neck to crown) keep the pin's waist.
    const lowerV = profileVolume(0, PIN.neckHeight);
    const upperV = profileVolume(PIN.neckHeight, PIN.height);
    const parts: Array<[number, number, number]> = [
      [0, PIN.neckHeight, lowerV],
      [PIN.neckHeight, PIN.height, upperV],
    ];
    for (const [from, to, volume] of parts) {
      const hull = R.ColliderDesc.convexHull(latheHullPoints(from, to));
      if (!hull) throw new Error('Pin collider could not be built.');
      this.world.createCollider(
        hull
          .setMass((PIN.mass * volume) / (lowerV + upperV))
          .setFriction(SURFACE.pinFriction)
          .setFrictionCombineRule(Min)
          .setRestitution(SURFACE.pinRestitution),
        body,
      );
    }
    return body;
  }

  private placeUpright(body: RAPIER.RigidBody, x: number, z: number): void {
    body.setEnabled(true);
    body.setTranslation({ x, y: 0, z }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** A full rack of 10 pins on their spots. */
  rackPins(): void {
    this.pins.forEach((pin, i) => this.placeUpright(pin, PIN_SPOTS[i].x, PIN_SPOTS[i].z));
    this.accumulator = 0;
  }

  /**
   * Second ball: the pinsetter sweeps away fallen pins and sets standing pins back
   * down, upright, where they stood.
   */
  respotStanding(standing: readonly boolean[]): void {
    this.pins.forEach((pin, i) => {
      if (!standing[i]) {
        pin.setEnabled(false);
        return;
      }
      const t = pin.translation();
      this.placeUpright(pin, t.x, t.z);
    });
    this.accumulator = 0;
  }

  /** Ball off the lane while the player gets ready. */
  holdBall(): void {
    this.ball.setEnabled(false);
  }

  launch({ x, speed, angle }: LaunchParams): void {
    const maxX = LANE.halfWidth - BALL.radius;
    const sx = Math.min(maxX, Math.max(-maxX, Number.isFinite(x) ? x : 0));
    const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    const a = Number.isFinite(angle) ? angle : 0;
    this.ball.setEnabled(true);
    this.ball.setTranslation({ x: sx, y: BALL.radius, z: BALL_RELEASE_Z }, true);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ball.setLinvel({ x: v * Math.sin(a), y: 0, z: -v * Math.cos(a) }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.accumulator = 0;
  }

  /** Advances by real elapsed time in fixed steps. Long stalls are dropped, not replayed. */
  step(elapsedSeconds: number): void {
    if (this.disposed || !(elapsedSeconds > 0)) return;
    this.accumulator = Math.min(this.accumulator + elapsedSeconds, FIXED_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= FIXED_DT) {
      this.world.step();
      this.accumulator -= FIXED_DT;
    }
    // Once in the pit the ball is out of play; the cushion would stop it.
    if (this.ball.isEnabled()) {
      const t = this.ball.translation();
      if (t.z < PIT_EDGE_Z - BALL.radius * 2 || t.y < -0.2) this.ball.setEnabled(false);
    }
  }

  ballInPlay(): boolean {
    return this.ball.isEnabled();
  }

  ballPose(): BodyPose {
    return poseOf(this.ball);
  }

  ballSpeed(): number {
    const v = this.ball.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Standing = upright, base on the deck, inside the lane edges and in front of the pit. */
  standingPins(): boolean[] {
    const cosMax = Math.cos(STANDING_MAX_TILT_RAD);
    return this.pins.map((pin) => {
      if (!pin.isEnabled()) return false;
      const t = pin.translation();
      const q = pin.rotation();
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      return (
        upY >= cosMax &&
        Math.abs(t.y) < 0.03 &&
        Math.abs(t.x) < LANE.halfWidth &&
        t.z > PIT_EDGE_Z
      );
    });
  }

  /** Every moving body has come to rest. */
  isSettled(linearTol = 0.03, angularTol = 0.2): boolean {
    const quiet = (b: RAPIER.RigidBody) => {
      if (!b.isEnabled() || b.isSleeping()) return true;
      const t = b.translation();
      // Pins that dropped into the pit are out of play whether they are still rolling or not.
      if (t.y < -0.12) return true;
      const v = b.linvel();
      const w = b.angvel();
      return Math.hypot(v.x, v.y, v.z) < linearTol && Math.hypot(w.x, w.y, w.z) < angularTol;
    };
    return quiet(this.ball) && this.pins.every(quiet);
  }

  snapshot(): BowlingSnapshot {
    return {
      ball: { ...poseOf(this.ball), inPlay: this.ball.isEnabled() },
      pins: this.pins.map((p) => ({ ...poseOf(p), inPlay: p.isEnabled() })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
  }
}
