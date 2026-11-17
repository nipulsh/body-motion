import type { PoseResult } from '../../../types';
import coreConfig from './config.json';
import {
  angleFromVertical,
  clamp,
  dist,
  dist3,
  lateralSign,
  LM,
  mid,
  sideIdx,
  SIDES,
  toImage,
  type P2,
  type Side,
  type V3,
} from './geometry';
import { PointsFilter } from './oneEuro';
import type { BasePose, RehabFrame, TrackingStatus, View } from './types';

export type CoreConfig = typeof coreConfig;

export interface TrackerOptions {
  /** Landmarks the game reads; tracking is unhealthy when any falls below the visibility floor. */
  requiredLandmarks: readonly number[];
  /** Seated play: no head-to-toe or leg-length checks; leg length is estimated from the torso. */
  seated?: boolean;
  config?: CoreConfig;
}

const FEET = [LM.lAnkle, LM.rAnkle, LM.lHeel, LM.rHeel, LM.lFoot, LM.rFoot];
const HANDS = [LM.lWrist, LM.rWrist, LM.lIndex, LM.rIndex];
const HEAD_TO_TOE = [LM.nose, LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip, ...FEET];
const UPPER_BODY = [LM.nose, LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip];

/** Boolean that changes only after `frames` consecutive frames disagree with it. */
export class Debounced {
  private pending = 0;
  constructor(
    public value: boolean,
    private readonly frames: number,
  ) {}
  update(raw: boolean): boolean {
    if (raw === this.value) {
      this.pending = 0;
      return this.value;
    }
    this.pending += 1;
    if (this.pending >= this.frames) {
      this.value = raw;
      this.pending = 0;
    }
    return this.value;
  }
  set(v: boolean): void {
    this.value = v;
    this.pending = 0;
  }
}

/**
 * Threshold with a hysteresis band: once above, stays above until the value
 * drops `pct` (relative) below the threshold, and the other way round.
 */
export function hysteresisAbove(value: number, threshold: number, wasAbove: boolean, pct: number): boolean {
  const band = Math.abs(threshold) * pct;
  return wasAbove ? value > threshold - band : value > threshold + band;
}

export function legLengthOf(pts: readonly P2[]): number {
  const hip = mid(pts[LM.lHip], pts[LM.rHip]);
  const ankle = mid(pts[LM.lAnkle], pts[LM.rAnkle]);
  return dist(hip, ankle);
}

export function torsoLengthOf(pts: readonly P2[]): number {
  return dist(mid(pts[LM.lShoulder], pts[LM.rShoulder]), mid(pts[LM.lHip], pts[LM.rHip]));
}

/** Front / side from shoulder width over torso length, with a hysteresis band between. */
export function detectView(pts: readonly P2[], previous: View, cfg: CoreConfig['view']): View {
  const torso = torsoLengthOf(pts);
  if (torso < 1e-6) return previous;
  const ratio = dist(pts[LM.lShoulder], pts[LM.rShoulder]) / torso;
  if (ratio > cfg.frontAbove) return 'front';
  if (ratio < cfg.sideBelow) return 'side';
  return previous;
}

/** Toe-out per foot from world landmarks: heel → foot index against the axis toward the camera. */
export function toeOutFromWorld(world: readonly V3[] | null, pts: readonly P2[], side: Side): number {
  if (!world || world.length < 33) return 0;
  const idx = sideIdx(side);
  const heel = world[idx.heel];
  const toe = world[idx.foot];
  const dx = (toe.x - heel.x) * lateralSign(pts, side);
  // MediaPipe world z is smaller toward the camera; the forward axis points at the camera.
  const forward = -(toe.z - heel.z);
  if (Math.hypot(dx, forward) < 1e-6) return 0;
  return (Math.atan2(dx, forward) * 180) / Math.PI;
}

function floorYOf(pts: readonly P2[], side: Side): number {
  const idx = sideIdx(side);
  return (pts[idx.heel].y + pts[idx.foot].y) / 2;
}

/** Arm length in image units, from world proportions when available (foreshortening-free). */
function armLengthOf(pts: readonly P2[], world: readonly V3[] | null, legLength: number): number {
  const armImg =
    (dist(pts[LM.lShoulder], pts[LM.lElbow]) +
      dist(pts[LM.lElbow], pts[LM.lWrist]) +
      dist(pts[LM.rShoulder], pts[LM.rElbow]) +
      dist(pts[LM.rElbow], pts[LM.rWrist])) /
    2;
  if (!world || world.length < 33) return armImg;
  const armW =
    (dist3(world[LM.lShoulder], world[LM.lElbow]) +
      dist3(world[LM.lElbow], world[LM.lWrist]) +
      dist3(world[LM.rShoulder], world[LM.rElbow]) +
      dist3(world[LM.rElbow], world[LM.rWrist])) /
    2;
  const legW =
    (dist3(world[LM.lHip], world[LM.lKnee]) +
      dist3(world[LM.lKnee], world[LM.lAnkle]) +
      dist3(world[LM.rHip], world[LM.rKnee]) +
      dist3(world[LM.rKnee], world[LM.rAnkle])) /
    2;
  if (legW < 1e-6) return armImg;
  return (armW / legW) * legLength;
}

/** Measures every base value from one (smoothed) standing frame. */
export function measureBase(frame: RehabFrame, seated: boolean, cfg: CoreConfig): BasePose {
  const p = frame.pts;
  const hipMid = mid(p[LM.lHip], p[LM.rHip]);
  const shoulderMid = mid(p[LM.lShoulder], p[LM.rShoulder]);
  const ankleMid = mid(p[LM.lAnkle], p[LM.rAnkle]);
  const torsoLength = dist(hipMid, shoulderMid);
  const legLength = seated ? torsoLength * cfg.base.seatedLegPerTorso : dist(hipMid, ankleMid);
  const thighLength = (dist(p[LM.lHip], p[LM.lKnee]) + dist(p[LM.rHip], p[LM.rKnee])) / 2;
  const shinLength = (dist(p[LM.lKnee], p[LM.lAnkle]) + dist(p[LM.rKnee], p[LM.rAnkle])) / 2;
  return {
    legLength,
    torsoLength,
    shoulderWidth: dist(p[LM.lShoulder], p[LM.rShoulder]),
    hipWidth: dist(p[LM.lHip], p[LM.rHip]),
    armLength: armLengthOf(p, frame.world, legLength),
    thighLength,
    shinLength,
    stanceWidth: Math.abs(p[LM.lAnkle].x - p[LM.rAnkle].x),
    hipHeight: seated ? legLength : ankleMid.y - hipMid.y,
    floorY: { left: floorYOf(p, 'left'), right: floorYOf(p, 'right') },
    kneeY: { left: p[LM.lKnee].y, right: p[LM.rKnee].y },
    heelToeDiff: {
      left: p[LM.lFoot].y - p[LM.lHeel].y,
      right: p[LM.rFoot].y - p[LM.rHeel].y,
    },
    toeOutDeg: {
      left: toeOutFromWorld(frame.world, p, 'left'),
      right: toeOutFromWorld(frame.world, p, 'right'),
    },
    trunkAngleDeg: angleFromVertical(hipMid, shoulderMid, true),
    shoulderHipDist: torsoLength,
    midlineX: (shoulderMid.x + hipMid.x) / 2,
    hipMid,
    ankleX: { left: p[LM.lAnkle].x, right: p[LM.rAnkle].x },
    view: frame.view,
    seated,
  };
}

/**
 * A re-base only follows small, posture-free changes (the patient settling or
 * drifting a little): lengths within `rebaseMaxChange`, and both feet flat on
 * their floor line. A held bow, raised heels or a lifted foot is a fault the
 * games must keep seeing, never a new standing pose.
 */
export function rebaseAllowed(base: BasePose, next: BasePose, cfg: CoreConfig['base']): boolean {
  if (next.view !== base.view) return false;
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-6);
  if (rel(next.legLength, base.legLength) >= cfg.rebaseMaxChange) return false;
  if (rel(next.torsoLength, base.torsoLength) >= cfg.rebaseMaxChange) return false;
  if (rel(next.hipHeight, base.hipHeight) >= cfg.rebaseMaxChange) return false;
  const footPct = (d: number) => (100 * Math.abs(d)) / Math.max(base.legLength, 1e-6);
  // Raised heels change heel-to-toe height; a lifted foot changes one floor line against the other.
  // Stepping closer moves both floor lines together, which the re-base must follow.
  for (const s of SIDES) {
    if (footPct(next.heelToeDiff[s] - base.heelToeDiff[s]) >= cfg.rebaseMaxFootPct) return false;
  }
  const floorGap = (b: BasePose) => b.floorY.left - b.floorY.right;
  return footPct(floorGap(next) - floorGap(base)) < cfg.rebaseMaxFootPct;
}

/** Blend `next` into `base` with weight `alpha` (numbers only; flags kept). */
function blendBase(base: BasePose, next: BasePose, alpha: number): BasePose {
  const b = (a: number, n: number) => a + (n - a) * alpha;
  const bs = (a: Record<Side, number>, n: Record<Side, number>) => ({ left: b(a.left, n.left), right: b(a.right, n.right) });
  return {
    ...base,
    legLength: b(base.legLength, next.legLength),
    torsoLength: b(base.torsoLength, next.torsoLength),
    shoulderWidth: b(base.shoulderWidth, next.shoulderWidth),
    hipWidth: b(base.hipWidth, next.hipWidth),
    armLength: b(base.armLength, next.armLength),
    thighLength: b(base.thighLength, next.thighLength),
    shinLength: b(base.shinLength, next.shinLength),
    stanceWidth: b(base.stanceWidth, next.stanceWidth),
    hipHeight: b(base.hipHeight, next.hipHeight),
    floorY: bs(base.floorY, next.floorY),
    kneeY: bs(base.kneeY, next.kneeY),
    heelToeDiff: bs(base.heelToeDiff, next.heelToeDiff),
    toeOutDeg: bs(base.toeOutDeg, next.toeOutDeg),
    shoulderHipDist: b(base.shoulderHipDist, next.shoulderHipDist),
    midlineX: b(base.midlineX, next.midlineX),
    hipMid: { x: b(base.hipMid.x, next.hipMid.x), y: b(base.hipMid.y, next.hipMid.y) },
    ankleX: bs(base.ankleX, next.ankleX),
  };
}

/** Scale of the body now against the base: shoulder width facing the mirror, leg segments side on. */
export function liveScale(pts: readonly P2[], base: BasePose | null, view: View): number {
  if (!base) return 1;
  if (view === 'side') {
    const seg = (dist(pts[LM.lHip], pts[LM.lKnee]) + dist(pts[LM.lKnee], pts[LM.lAnkle]) +
      dist(pts[LM.rHip], pts[LM.rKnee]) + dist(pts[LM.rKnee], pts[LM.rAnkle])) / 2;
    const ref = base.thighLength + base.shinLength;
    return ref > 1e-6 ? clamp(seg / ref, 0.5, 2) : 1;
  }
  const sw = dist(pts[LM.lShoulder], pts[LM.rShoulder]);
  return base.shoulderWidth > 1e-6 ? clamp(sw / base.shoulderWidth, 0.5, 2) : 1;
}

/**
 * Body size against the base for the one-person anchor. Turning, squatting and
 * bowing each change some lengths but never all of them: torso length survives
 * turning and squatting, leg segments survive turning and bowing. Someone else
 * at a different distance changes every length, so the measure closest to the
 * base wins.
 */
export function anchorScale(pts: readonly P2[], base: BasePose): number {
  const candidates: number[] = [];
  const segRef = base.thighLength + base.shinLength;
  if (segRef > 1e-6) {
    const seg =
      (dist(pts[LM.lHip], pts[LM.lKnee]) + dist(pts[LM.lKnee], pts[LM.lAnkle]) +
        dist(pts[LM.rHip], pts[LM.rKnee]) + dist(pts[LM.rKnee], pts[LM.rAnkle])) /
      2;
    candidates.push(seg / segRef);
  }
  if (base.torsoLength > 1e-6) candidates.push(torsoLengthOf(pts) / base.torsoLength);
  if (!candidates.length) return 1;
  const off = (c: number) => Math.abs(Math.log(Math.max(c, 1e-6)));
  return candidates.reduce((best, c) => (off(c) < off(best) ? c : best));
}

interface Sample {
  t: number;
  hip: P2;
}

/**
 * Smoothing, one-person lock, tracking health, view detection and the
 * automatic base pose. Feed every pose frame (or null) in time order.
 */
export class RehabTracker {
  private readonly cfg: CoreConfig;
  private requiredLandmarks: readonly number[];
  private seated: boolean;
  private readonly filter2d: PointsFilter;
  private readonly filter3d: PointsFilter;

  private lastAccepted: { t: number; hip: P2; size: number } | null = null;
  private lastSeenT: number | null = null;
  private healthy: Debounced;
  private viewState: View = 'unknown';
  private viewCandidate: View = 'unknown';
  private viewCount = 0;
  private legOk = true;
  private legTooBig = false;
  private history: Sample[] = [];
  private stillSince: number | null = null;
  private base: BasePose | null = null;
  private scaleSmoothed = 1;
  private personLocked = true;

  constructor(options: TrackerOptions) {
    this.cfg = options.config ?? coreConfig;
    this.requiredLandmarks = options.requiredLandmarks;
    this.seated = Boolean(options.seated);
    const e = this.cfg.tracking.oneEuro;
    this.filter2d = new PointsFilter(2, e.minCutoff, e.beta, e.dCutoff);
    this.filter3d = new PointsFilter(3, e.minCutoff, e.beta, e.dCutoff);
    this.healthy = new Debounced(false, this.cfg.tracking.confirmFrames);
  }

  configure(requiredLandmarks: readonly number[], seated: boolean): void {
    this.requiredLandmarks = requiredLandmarks;
    this.seated = seated;
  }

  /** Forget the base so the next stand-still captures a new one. */
  resetBase(): void {
    this.base = null;
    this.stillSince = null;
    this.history = [];
  }

  getBase(): BasePose | null {
    return this.base;
  }

  private status(message: string | null, healthy: boolean, frame: RehabFrame | null): TrackingStatus {
    let progress = 0;
    if (this.base) progress = 1;
    else if (this.stillSince !== null && frame) progress = clamp((frame.t - this.stillSince) / this.cfg.base.stillSeconds, 0, 1);
    return {
      frame,
      healthy,
      message: healthy ? null : message,
      base: this.base,
      baseProgress: progress,
      view: this.viewState,
      personLocked: this.personLocked,
    };
  }

  private missing(t: number, message: string): TrackingStatus {
    this.healthy.update(false);
    this.stillSince = null;
    if (this.lastSeenT !== null && t - this.lastSeenT >= this.cfg.tracking.lostRelockSeconds) {
      // Gone long enough: let whoever is in front next become the locked person,
      // with a fresh base pose.
      this.lastAccepted = null;
      this.personLocked = true;
      this.base = null;
      this.stillSince = null;
      this.history = [];
      this.filter2d.reset();
      this.filter3d.reset();
    }
    return this.status(message, this.healthy.value, null);
  }

  update(pose: PoseResult | null, t: number): TrackingStatus {
    const msgs = this.cfg.trackingMessages;
    if (!pose || pose.landmarks.length < 33) {
      if (this.lastSeenT === null) this.lastSeenT = t;
      return this.missing(t, msgs.body);
    }
    const aspect = pose.frameAspect && pose.frameAspect > 0 ? pose.frameAspect : 16 / 9;
    const raw = pose.landmarks.map((l) => toImage(l, aspect));

    // One-person lock: a sudden jump in position or size is someone else.
    const rawHip = mid(raw[LM.lHip], raw[LM.rHip]);
    const rawSize = torsoLengthOf(raw);
    const tc = this.cfg.tracking;
    let otherPerson = false;
    if (this.lastAccepted) {
      const dt = Math.max(0.033, t - this.lastAccepted.t);
      const growth = Math.min(tc.personJumpMaxGrowth, Math.max(1, dt / 0.1));
      const allowed = tc.personJumpShoulderWidths * Math.max(rawSize * 0.6, 0.02) * growth;
      const sizeJump = Math.abs(rawSize - this.lastAccepted.size) / Math.max(this.lastAccepted.size, 1e-6);
      otherPerson = dist(rawHip, this.lastAccepted.hip) > allowed || (dt < 0.5 && sizeJump > tc.personScaleJump);
    }
    if (!otherPerson && this.base) {
      // Anchor to the person the base was taken from: same place, same size.
      // The size measure survives turning, squatting and bowing (see anchorScale).
      const width = Math.max(this.base.shoulderWidth, this.base.torsoLength * 0.6);
      const size = anchorScale(raw, this.base);
      otherPerson =
        dist(rawHip, this.base.hipMid) > tc.anchorShoulderWidths * width * Math.max(1, size) ||
        size < tc.anchorSizeRange[0] ||
        size > tc.anchorSizeRange[1];
    }
    if (this.lastAccepted || this.base) {
      if (otherPerson) {
        this.personLocked = false;
        if (this.lastSeenT === null) this.lastSeenT = this.lastAccepted?.t ?? t;
        return this.missing(t, msgs.body);
      }
    }
    this.personLocked = true;
    this.lastAccepted = { t, hip: rawHip, size: rawSize };
    this.lastSeenT = t;

    const flat = this.filter2d.filter(raw.flatMap((p) => [p.x, p.y]), t);
    const pts: P2[] = [];
    for (let i = 0; i < raw.length; i += 1) pts.push({ x: flat[i * 2], y: flat[i * 2 + 1] });
    const vis = pose.landmarks.map((l) => l.visibility ?? 0);
    let world: V3[] | null = null;
    if (pose.worldLandmarks && pose.worldLandmarks.length >= 33) {
      const w = this.filter3d.filter(pose.worldLandmarks.flatMap((l) => [l.x, l.y, l.z]), t);
      world = [];
      for (let i = 0; i < pose.worldLandmarks.length; i += 1) world.push({ x: w[i * 3], y: w[i * 3 + 1], z: w[i * 3 + 2] });
    }

    // View, confirmed over a few frames.
    const rawView = detectView(pts, this.viewState, this.cfg.view);
    if (rawView !== this.viewState) {
      if (rawView === this.viewCandidate) this.viewCount += 1;
      else {
        this.viewCandidate = rawView;
        this.viewCount = 1;
      }
      if (this.viewCount >= this.cfg.tracking.confirmFrames) {
        this.viewState = rawView;
        this.viewCount = 0;
      }
    } else this.viewCount = 0;

    const scaleRaw = liveScale(pts, this.base, this.viewState);
    this.scaleSmoothed += (scaleRaw - this.scaleSmoothed) * 0.2;
    const frame: RehabFrame = { t, pts, vis, world, aspect, view: this.viewState, scale: this.base ? this.scaleSmoothed : 1 };

    // Health: required landmarks seen, body a usable size on screen.
    const minVis = this.cfg.tracking.minVisibility;
    const missingIdx = this.requiredLandmarks.filter((i) => (vis[i] ?? 0) < minVis);
    let message: string | null = null;
    if (missingIdx.length > 0) {
      if (missingIdx.some((i) => FEET.includes(i as (typeof FEET)[number]))) message = msgs.feet;
      else if (missingIdx.some((i) => HANDS.includes(i as (typeof HANDS)[number]))) message = msgs.hands;
      else message = msgs.body;
    }
    const needsLegs = !this.seated && this.requiredLandmarks.some((i) => FEET.includes(i as (typeof FEET)[number]));
    if (!message && needsLegs) {
      // After the base locks, use its leg length at the live body size: squatting shortens hip-to-ankle.
      const legFrac = this.base ? this.base.legLength * scaleRaw : legLengthOf(pts);
      const h = this.cfg.tracking.hysteresis;
      const tooBig = hysteresisAbove(legFrac, this.cfg.tracking.legFrameMax, this.legTooBig, h);
      const tooSmall = !hysteresisAbove(legFrac, this.cfg.tracking.legFrameMin, this.legOk || this.legTooBig, h);
      this.legTooBig = tooBig;
      this.legOk = !tooBig && !tooSmall;
      if (tooBig) message = msgs.feet;
      else if (tooSmall) message = msgs.closer;
    }
    const healthy = this.healthy.update(message === null);

    this.updateBase(frame, healthy);
    return this.status(message ?? msgs.body, healthy, frame);
  }

  private updateBase(frame: RehabFrame, healthy: boolean): void {
    const cfg = this.cfg.base;
    const p = frame.pts;
    const hip = mid(p[LM.lHip], p[LM.rHip]);
    this.history.push({ t: frame.t, hip });
    while (this.history.length > 2 && frame.t - this.history[0].t > cfg.speedWindowSeconds) this.history.shift();

    const leg = this.base?.legLength ?? (this.seated ? torsoLengthOf(p) * cfg.seatedLegPerTorso : legLengthOf(p));
    const oldest = this.history[0];
    const span = frame.t - oldest.t;
    const speed = span > 0.2 && leg > 1e-6 ? dist(hip, oldest.hip) / span / leg : Infinity;
    const still = healthy && speed < cfg.maxHipSpeedLegPerSec && this.inFrame(frame);

    if (!still) {
      this.stillSince = null;
      return;
    }
    if (this.stillSince === null) this.stillSince = frame.t;
    const stillFor = frame.t - this.stillSince;

    if (!this.base) {
      if (stillFor >= cfg.stillSeconds) this.base = measureBase(frame, this.seated, this.cfg);
      return;
    }

    // Slow re-base while still and tall, only for small changes.
    if (stillFor < cfg.rebaseStillSeconds) return;
    const next = measureBase(frame, this.seated, this.cfg);
    if (next.hipHeight < (this.base.hipHeight * cfg.tallHipPct) / 100) return;
    if (!rebaseAllowed(this.base, next, cfg)) return;
    this.base = blendBase(this.base, next, cfg.rebaseAlpha);
  }

  /** Head to toe inside the picture (upper body only when seated). */
  private inFrame(frame: RehabFrame): boolean {
    const ids = this.seated ? UPPER_BODY : HEAD_TO_TOE;
    const minVis = this.cfg.tracking.minVisibility;
    return ids.every((i) => {
      const p = frame.pts[i];
      const nx = p.x / frame.aspect;
      return (frame.vis[i] ?? 0) >= minVis && nx >= 0 && nx <= 1 && p.y >= 0 && p.y <= 1;
    });
  }
}

export { SIDES };
