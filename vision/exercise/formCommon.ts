import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult, Vec3 } from '../types';

export type BodySide = 'left' | 'right';

export interface Tilt {
  deg: number;
  /** Side the body part drops or leans toward (the patient's own left/right). */
  toward: BodySide;
}

/** Knee drifting off the vertical line above its toe, as seen from the front. */
export type KneeLineFaultCode =
  | 'left_knee_inward'
  | 'left_knee_outward'
  | 'right_knee_inward'
  | 'right_knee_outward';

export const KNEE_LINE_FAULTS: Record<BodySide, { inward: KneeLineFaultCode; outward: KneeLineFaultCode }> = {
  left: { inward: 'left_knee_inward', outward: 'left_knee_outward' },
  right: { inward: 'right_knee_inward', outward: 'right_knee_outward' },
};

export interface LegLandmarks {
  shoulder: PoseLandmarkName;
  hip: PoseLandmarkName;
  knee: PoseLandmarkName;
  ankle: PoseLandmarkName;
  heel: PoseLandmarkName;
  toe: PoseLandmarkName;
}

export const SIDE_LANDMARKS: Record<BodySide, LegLandmarks> = {
  left: {
    shoulder: 'leftShoulder',
    hip: 'leftHip',
    knee: 'leftKnee',
    ankle: 'leftAnkle',
    heel: 'leftHeel',
    toe: 'leftFootIndex',
  },
  right: {
    shoulder: 'rightShoulder',
    hip: 'rightHip',
    knee: 'rightKnee',
    ankle: 'rightAnkle',
    heel: 'rightHeel',
    toe: 'rightFootIndex',
  },
};

const RAD_TO_DEG = 180 / Math.PI;

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * Unit direction in the camera plane (image y points down) that the body treats as "up".
 * Tilt and lean angles are measured against this axis instead of the screen, so a camera
 * that is rolled, or rolls mid-session, does not change the angle of a body that has not moved.
 */
export interface BodyAxis {
  x: number;
  y: number;
}

/** Screen up: the fallback until the feet give a body reference. */
export const SCREEN_UP: BodyAxis = { x: 0, y: -1 };

function along(dx: number, dy: number, up: BodyAxis): number {
  return dx * up.x + dy * up.y;
}

/** Body-right component: `up` turned a quarter turn clockwise on screen ((0,-1) → (1,0)). */
function across(dx: number, dy: number, up: BodyAxis): number {
  return dx * -up.y + dy * up.x;
}

/** Signed distance of `to` from `from` along the body's up axis (positive = higher on the body). */
export function upComponent(from: Vec3, to: Vec3, up: BodyAxis = SCREEN_UP): number {
  return along(to.x - from.x, to.y - from.y, up);
}

/** Signed distance of `to` from `from` along the body's left–right axis (image-right when upright). */
export function sideComponent(from: Vec3, to: Vec3, up: BodyAxis = SCREEN_UP): number {
  return across(to.x - from.x, to.y - from.y, up);
}

/** Angle of segment from→to away from the body's up axis, in degrees [0, 180]. */
export function fromVerticalDeg(from: Vec3, to: Vec3, up: BodyAxis = SCREEN_UP): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.atan2(Math.abs(across(dx, dy, up)), along(dx, dy, up)) * RAD_TO_DEG;
}

/** Like `fromVerticalDeg`, signed: positive leaning toward image-right when upright, in (−180, 180]. */
export function signedFromVerticalDeg(from: Vec3, to: Vec3, up: BodyAxis = SCREEN_UP): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.atan2(across(dx, dy, up), along(dx, dy, up)) * RAD_TO_DEG;
}

/**
 * Like `fromVerticalDeg`, counting depth too, in [0, 180]. Face on, a thigh swings toward the
 * camera, so only metric depth shows how far it has left the vertical.
 */
export function fromVertical3dDeg(from: Vec3, to: Vec3, up: BodyAxis = SCREEN_UP): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.atan2(Math.hypot(across(dx, dy, up), to.z - from.z), along(dx, dy, up)) * RAD_TO_DEG;
}

/** Trunk midline (hip centre → shoulder centre) against the up axis, and the side it leans toward. */
export function trunkMidlineTilt(
  leftShoulder: Vec3,
  rightShoulder: Vec3,
  leftHip: Vec3,
  rightHip: Vec3,
  up: BodyAxis = SCREEN_UP,
): Tilt {
  const hipMid = midpoint(leftHip, rightHip);
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const leansLeft =
    Math.sign(sideComponent(hipMid, shoulderMid, up)) === Math.sign(sideComponent(rightHip, leftHip, up));
  return { deg: round1(fromVerticalDeg(hipMid, shoulderMid, up)), toward: leansLeft ? 'left' : 'right' };
}

function unitAxis(x: number, y: number): BodyAxis | null {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length < 1e-6) return null;
  return { x: x / length, y: y / length };
}

/** Perpendicular to the line a→b, pointing toward `toward`. */
function perpendicularToward(a: Vec3, b: Vec3, toward: Vec3): BodyAxis | null {
  const normal = unitAxis(-(b.y - a.y), b.x - a.x);
  if (!normal) return null;
  const mid = midpoint(a, b);
  const side = (toward.x - mid.x) * normal.x + (toward.y - mid.y) * normal.y;
  return side >= 0 ? normal : { x: -normal.x, y: -normal.y };
}

/**
 * Body "up" from the wireframe itself: perpendicular to the ground line under the feet.
 * Front on, that line runs from one foot to the other; side on, from heel to toe of the
 * near foot. Uses camera-plane points (`LandmarkSpace.pixel`). Null when the feet are not seen.
 */
export function groundUpCandidate(
  space: LandmarkSpace,
  view: 'front' | 'side',
  side: BodySide = 'left',
): BodyAxis | null {
  if (view === 'side') {
    for (const foot of [side, side === 'left' ? 'right' : 'left'] as const) {
      const names = SIDE_LANDMARKS[foot];
      const toe = space.pixel(names.toe);
      const heel = space.pixel(names.heel) ?? space.pixel(names.ankle);
      const knee = space.pixel(names.knee);
      if (!toe || !heel || !knee) continue;
      const footLength = Math.hypot(toe.x - heel.x, toe.y - heel.y);
      const shin = Math.hypot(knee.x - heel.x, knee.y - heel.y);
      // A foot pointing at the camera foreshortens to a dot and gives no usable line.
      if (shin <= 0 || footLength < shin * 0.2) continue;
      return perpendicularToward(heel, toe, knee);
    }
    return null;
  }
  const footPoint = (foot: BodySide): Vec3 | null => {
    const names = SIDE_LANDMARKS[foot];
    const points = [space.pixel(names.ankle), space.pixel(names.heel)].filter((p): p is Vec3 => p !== null);
    if (points.length === 0) return null;
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
      z: 0,
    };
  };
  const left = footPoint('left');
  const right = footPoint('right');
  const lh = space.pixel('leftHip');
  const rh = space.pixel('rightHip');
  if (!left || !right || !lh || !rh) return null;
  const hipMid = midpoint(lh, rh);
  const footSpan = Math.hypot(left.x - right.x, left.y - right.y);
  const legLength = Math.hypot(hipMid.x - (left.x + right.x) / 2, hipMid.y - (left.y + right.y) / 2);
  // Feet almost on top of each other leave the ground line undefined.
  if (legLength <= 0 || footSpan < legLength * 0.08) return null;
  return perpendicularToward(left, right, hipMid);
}

/** Angle between two body axes, in degrees [0, 180]. */
export function axisAngleDeg(a: BodyAxis, b: BodyAxis): number {
  return Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y))) * RAD_TO_DEG;
}

/**
 * Smoothed body-up axis. Feed it a ground candidate every frame; while `allowUpdate` is
 * false (e.g. a staggered lunge stance) it holds the last reference instead.
 *
 * Smoothing adapts to the change: small differences (landmark jitter) are averaged, while
 * a real camera roll of several degrees is followed almost at once, so readings do not
 * overshoot while the camera moves.
 */
export class BodyAxisTracker {
  private axis: BodyAxis | null = null;

  constructor(
    private readonly minAlpha = 0.35,
    /** A change this large (degrees) is followed fully in one frame. */
    private readonly snapDeg = 4,
  ) {}

  reset(): void {
    this.axis = null;
  }

  has(): boolean {
    return this.axis !== null;
  }

  current(): BodyAxis {
    return this.axis ?? SCREEN_UP;
  }

  update(candidate: BodyAxis | null, allowUpdate = true): BodyAxis {
    if (!candidate || !allowUpdate) return this.current();
    if (!this.axis) {
      this.axis = candidate;
      return candidate;
    }
    const alpha = Math.min(1, Math.max(this.minAlpha, axisAngleDeg(this.axis, candidate) / this.snapDeg));
    const blended = unitAxis(
      this.axis.x + (candidate.x - this.axis.x) * alpha,
      this.axis.y + (candidate.y - this.axis.y) * alpha,
    );
    this.axis = blended ?? candidate;
    return this.axis;
  }
}

/** The four screen-edge directions, screen up first. */
const SCREEN_AXES: readonly BodyAxis[] = [SCREEN_UP, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

/** The screen-edge direction closest to `axis`. */
export function nearestScreenAxis(axis: BodyAxis): BodyAxis {
  let best = SCREEN_AXES[0]!;
  let bestDot = -Infinity;
  for (const candidate of SCREEN_AXES) {
    const dot = candidate.x * axis.x + candidate.y * axis.y;
    if (dot > bestDot) {
      best = candidate;
      bestDot = dot;
    }
  }
  return best;
}

/** Mean camera-plane point of whichever of `names` are visible. */
function visibleMean(space: LandmarkSpace, names: readonly PoseLandmarkName[]): Vec3 | null {
  const points = names.map((name) => space.pixel(name)).filter((p): p is Vec3 => p !== null);
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    z: 0,
  };
}

/**
 * Which way the whole wireframe points: from the ankles (or the knees, feet out of view) up to
 * the shoulders, in camera-plane pixels. The trunk alone is never used, since a deadlift hinge
 * tips the back toward horizontal while the body is still standing. Null when it is not seen.
 */
export function bodyLengthAxis(space: LandmarkSpace): BodyAxis | null {
  const top = visibleMean(space, ['leftShoulder', 'rightShoulder']);
  if (!top) return null;
  const base = visibleMean(space, ['leftAnkle', 'rightAnkle']) ?? visibleMean(space, ['leftKnee', 'rightKnee']);
  if (!base) return null;
  return unitAxis(top.x - base.x, top.y - base.y);
}

/**
 * Reference axis locked to the screen edges. It is always exactly screen up, right, down or
 * left, so reference lines are square to the edges and never wobble with landmark noise. It
 * turns only once the wireframe has pointed more than `switchDeg` away for `switchFrames`
 * frames in a row: standing to lying flips past 60°, and back below 30°.
 */
export class ScreenAxisLock {
  private axis: BodyAxis = SCREEN_UP;
  private pending: BodyAxis | null = null;
  private pendingFrames = 0;

  constructor(
    private readonly switchDeg = 60,
    private readonly switchFrames = 5,
  ) {}

  reset(): void {
    this.axis = SCREEN_UP;
    this.pending = null;
    this.pendingFrames = 0;
  }

  current(): BodyAxis {
    return this.axis;
  }

  update(candidate: BodyAxis | null): BodyAxis {
    const unit = candidate ? unitAxis(candidate.x, candidate.y) : null;
    if (!unit) return this.axis;
    if (axisAngleDeg(this.axis, unit) <= this.switchDeg) {
      this.pending = null;
      this.pendingFrames = 0;
      return this.axis;
    }
    const target = nearestScreenAxis(unit);
    if (this.pending && this.pending.x === target.x && this.pending.y === target.y) {
      this.pendingFrames += 1;
    } else {
      this.pending = target;
      this.pendingFrames = 1;
    }
    if (this.pendingFrames >= this.switchFrames) {
      this.axis = target;
      this.pending = null;
      this.pendingFrames = 0;
    }
    return this.axis;
  }
}

/** Where the body "up" axis came from this frame. `screen` means camera roll is not corrected. */
export type BodyReference = 'feet' | 'held' | 'legs' | 'screen';

/**
 * How far the feet line may disagree with the other body cues before it is distrusted.
 * Well above ankle/heel landmark jitter (a few degrees) and 3x the largest tilt screening
 * threshold (4°), so a clinically sized real deviation never flips the reference.
 */
const FEET_GATE_DEG = 12;

/** Perpendicular to the hip line, pointing toward the shoulders. */
function hipLineUpAxis(space: LandmarkSpace): BodyAxis | null {
  const lh = space.pixel('leftHip');
  const rh = space.pixel('rightHip');
  const ls = space.pixel('leftShoulder');
  const rs = space.pixel('rightShoulder');
  if (!lh || !rh) return null;
  const toward = ls && rs ? midpoint(ls, rs) : { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 - 1, z: 0 };
  return perpendicularToward(lh, rh, toward);
}

/** Front view: hips above the ankles (or knees when the feet are out of view). */
function legsUpAxis(space: LandmarkSpace): BodyAxis | null {
  const lh = space.pixel('leftHip');
  const rh = space.pixel('rightHip');
  if (!lh || !rh) return null;
  const hipMid = midpoint(lh, rh);
  for (const pair of [['leftAnkle', 'rightAnkle'], ['leftKnee', 'rightKnee']] as const) {
    const a = space.pixel(pair[0]);
    const b = space.pixel(pair[1]);
    if (!a || !b) continue;
    const base = midpoint(a, b);
    return unitAxis(hipMid.x - base.x, hipMid.y - base.y);
  }
  return null;
}

/**
 * Resolve the body's up axis for one frame, most trusted source first:
 *   feet  – perpendicular to the ground line (front: foot to foot; side: heel to toe)
 *   held  – the last trusted axis (feet staggered, lifted, or a lunge in progress)
 *   legs  – front view only: ankle/knee midpoint up to the hip midpoint
 *   screen – nothing usable; camera roll is not corrected and callers should say so
 * Front on, the feet line is rejected only when it disagrees with both the legs and the hip
 * line: one foot stepped forward sits lower in the image and tilts the feet line away from
 * both, while a real sideways hip shift tilts the legs but leaves hips parallel to the feet.
 */
export function resolveBodyUp(
  space: LandmarkSpace,
  view: 'front' | 'side',
  side: BodySide,
  tracker: BodyAxisTracker,
  allowUpdate = true,
): { up: BodyAxis; reference: BodyReference } {
  let candidate = groundUpCandidate(space, view, side);
  const legs = view === 'front' ? legsUpAxis(space) : null;
  if (candidate && legs && axisAngleDeg(candidate, legs) > FEET_GATE_DEG) {
    const hips = hipLineUpAxis(space);
    if (!hips || axisAngleDeg(candidate, hips) > FEET_GATE_DEG) candidate = null;
  }
  if (candidate && allowUpdate) return { up: tracker.update(candidate), reference: 'feet' };
  if (tracker.has()) return { up: tracker.current(), reference: 'held' };
  if (legs) return { up: legs, reference: 'legs' };
  return { up: SCREEN_UP, reference: 'screen' };
}

/**
 * Knee flexion: the angle between the femur (hip→knee) and the shin (knee→ankle).
 * A straight leg, where the bones line up at 180°, reads 0°; a right-angle bend reads 90°.
 */
export function kneeFlexionDeg(hip: Vec3, knee: Vec3, ankle: Vec3): number {
  const femur = { x: knee.x - hip.x, y: knee.y - hip.y, z: knee.z - hip.z };
  const shin = { x: ankle.x - knee.x, y: ankle.y - knee.y, z: ankle.z - knee.z };
  const lengths = Math.hypot(femur.x, femur.y, femur.z) * Math.hypot(shin.x, shin.y, shin.z);
  if (lengths === 0) return Number.NaN;
  const cos = (femur.x * shin.x + femur.y * shin.y + femur.z * shin.z) / lengths;
  return Math.acos(Math.min(1, Math.max(-1, cos))) * RAD_TO_DEG;
}

/** Knee included angle between thigh and shin: 180° with the leg straight, 90° at a right angle. */
export function kneeIncludedDeg(hip: Vec3, knee: Vec3, ankle: Vec3): number {
  return 180 - kneeFlexionDeg(hip, knee, ankle);
}

/** The point projected onto the camera plane, for side-view angles measured as the camera sees them. */
export function flat(point: Vec3): Vec3 {
  return { x: point.x, y: point.y, z: 0 };
}

/** Angle of the left–right line against the body's horizontal, and which side is lower. */
export function lineTilt(left: Vec3, right: Vec3, up: BodyAxis = SCREEN_UP): Tilt {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const deg = Math.atan2(Math.abs(along(dx, dy, up)), Math.abs(across(dx, dy, up))) * RAD_TO_DEG;
  return { deg: round1(deg), toward: along(dx, dy, up) < 0 ? 'left' : 'right' };
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Pose landmarks for measurement: metric world points, gated by image-space visibility. */
export class LandmarkSpace {
  private readonly points: readonly Vec3[];
  private readonly image: readonly PoseLandmark[];
  private readonly minVisibility: number;
  readonly frameAspect: number;

  constructor(pose: PoseResult, frameAspect: number, minVisibility: number) {
    this.image = pose.landmarks;
    this.minVisibility = minVisibility;
    this.frameAspect = frameAspect > 0 && Number.isFinite(frameAspect) ? frameAspect : 1;
    // World landmarks are metric and isotropic. Image x and y are normalized to different
    // pixel spans, so without them x is rescaled by the frame aspect to keep angles true.
    const world = pose.worldLandmarks;
    this.points =
      world && world.length >= 33
        ? world
        : pose.landmarks.map((lm) => ({ x: lm.x * frameAspect, y: lm.y, z: 0 }));
  }

  get(name: PoseLandmarkName): Vec3 | null {
    const index = POSE_LANDMARK_INDEX[name];
    const image = this.image[index];
    const point = this.points[index];
    if (!image || !point || image.visibility < this.minVisibility) return null;
    return point;
  }

  /** Camera-plane point with x and y in the same units (image height), gated by visibility. */
  pixel(name: PoseLandmarkName): Vec3 | null {
    const image = this.image[POSE_LANDMARK_INDEX[name]];
    if (!image || image.visibility < this.minVisibility) return null;
    if (!Number.isFinite(image.x) || !Number.isFinite(image.y)) return null;
    return { x: image.x * this.frameAspect, y: image.y, z: 0 };
  }

  /** A camera-plane axis expressed in normalized image coordinates, for drawing. */
  imageDirection(axis: BodyAxis): { x: number; y: number } {
    return { x: axis.x / this.frameAspect, y: axis.y };
  }

  imagePoint(name: PoseLandmarkName): { x: number; y: number } | null {
    const image = this.image[POSE_LANDMARK_INDEX[name]];
    return image ? { x: image.x, y: image.y } : null;
  }

  visibility(name: PoseLandmarkName): number {
    return this.image[POSE_LANDMARK_INDEX[name]]?.visibility ?? 0;
  }
}

export interface FaultStatus<Code extends string> {
  code: Code;
  since: number;
  /** Present for at least `sustainMs`. Only sustained faults are corrected. */
  sustained: boolean;
}

export interface FormResult<Frame, Code extends string> {
  frame: Frame | null;
  /** Faults present now (pending or sustained), in priority order. */
  faults: FaultStatus<Code>[];
  correctReps: number;
  incorrectReps: number;
}

export interface FaultTimingConfig {
  /** A fault must persist this long before it counts (and is spoken). */
  sustainMs: number;
  /** A fault missing for less than this keeps its onset, so one dropped frame does not restart the timer. */
  dropoutGraceMs: number;
}

interface FaultTrack {
  since: number;
  lastSeen: number;
}

/**
 * Turns per-frame faults into held faults: a fault counts once it has lasted
 * `sustainMs`, and each completed rep is scored correct or incorrect by
 * whether any fault was held during it.
 */
export class FaultTimer<Code extends string> {
  private readonly tracks = new Map<Code, FaultTrack>();
  private lastRepCount = 0;
  private repHadFault = false;
  private correctReps = 0;
  private incorrectReps = 0;

  constructor(
    private readonly priority: readonly Code[],
    private readonly timing: FaultTimingConfig,
  ) {}

  reset(): void {
    this.tracks.clear();
    this.lastRepCount = 0;
    this.repHadFault = false;
    this.correctReps = 0;
    this.incorrectReps = 0;
  }

  update<Frame>(
    frame: Frame | null,
    frameFaults: readonly Code[],
    timestamp: number,
    repCount: number,
  ): FormResult<Frame, Code> {
    for (const code of frameFaults) {
      const track = this.tracks.get(code);
      if (track) track.lastSeen = timestamp;
      else this.tracks.set(code, { since: timestamp, lastSeen: timestamp });
    }
    for (const [code, track] of this.tracks) {
      if (timestamp - track.lastSeen > this.timing.dropoutGraceMs) this.tracks.delete(code);
    }

    const faults: FaultStatus<Code>[] = [];
    for (const code of this.priority) {
      const track = this.tracks.get(code);
      if (!track) continue;
      const sustained = timestamp - track.since >= this.timing.sustainMs;
      if (sustained) this.repHadFault = true;
      faults.push({ code, since: track.since, sustained });
    }

    this.scoreReps(repCount);
    return { frame, faults, correctReps: this.correctReps, incorrectReps: this.incorrectReps };
  }

  private scoreReps(repCount: number): void {
    if (repCount < this.lastRepCount) {
      this.lastRepCount = repCount;
      this.correctReps = 0;
      this.incorrectReps = 0;
      this.repHadFault = false;
      return;
    }
    if (repCount === this.lastRepCount) return;
    const newReps = repCount - this.lastRepCount;
    if (this.repHadFault) {
      this.incorrectReps += 1;
      this.correctReps += newReps - 1;
    } else {
      this.correctReps += newReps;
    }
    this.lastRepCount = repCount;
    this.repHadFault = false;
  }
}
