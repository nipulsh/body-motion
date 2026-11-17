import type { PoseLandmark } from '../types';
import { getLandmark, POSE_LANDMARK_INDEX, type PoseLandmarkName } from './landmarks';
import {
  cameraToBody,
  type FrameSize,
  type MirrorGeometry,
  type MirrorPoint,
} from './mirrorReflection';
import { isLandmarkVisible, type Point2D } from './wireframe';
import { EYE_MIN_VISIBILITY } from './wireframeTracking';
import type { TrackedHand } from '../hand/handLandmarksBus';

export const CM_PER_IN = 2.54;

/** How far the wireframe drops per inch the hips descend below the standing baseline. */
export function squatDepthExtraDropIn(depthIn: number, gain: number): number {
  if (!Number.isFinite(depthIn) || depthIn <= 0 || !Number.isFinite(gain) || gain <= 0) return 0;
  return depthIn * gain;
}

/** Squat depth in inches from hip height on the body plane (positive when hips drop). */
export function estimateHipMidpointBody(
  landmarks: readonly PoseLandmark[] | null | undefined,
  frame: FrameSize,
  geometry: MirrorGeometry,
  distanceIn: number,
): MirrorPoint | null {
  if (!landmarks?.length) return null;
  const left = getLandmark(landmarks, 'leftHip');
  const right = getLandmark(landmarks, 'rightHip');
  if (
    !isLandmarkVisible(left, EYE_MIN_VISIBILITY) ||
    !isLandmarkVisible(right, EYE_MIN_VISIBILITY)
  ) {
    return null;
  }
  const bodyLeft = cameraToBody(left!, frame, geometry, distanceIn);
  const bodyRight = cameraToBody(right!, frame, geometry, distanceIn);
  if (!bodyLeft || !bodyRight) return null;
  return { x: (bodyLeft.x + bodyRight.x) / 2, h: (bodyLeft.h + bodyRight.h) / 2 };
}

const STANDING_DEPTH_EPS_IN = 0.75;

/**
 * Tracks the highest hip height seen as standing baseline and the current
 * squat depth below that baseline.
 */
export class SquatDepthTracker {
  private baselineH: number | null = null;
  private lastSeenAt: number | null = null;

  constructor(private readonly resetMs = 3000) {}

  /** Current squat depth in inches (0 when at or above baseline). */
  get depthIn(): number {
    return this._depthIn;
  }

  private _depthIn = 0;

  reset(): void {
    this.baselineH = null;
    this._depthIn = 0;
    this.lastSeenAt = null;
  }

  update(hip: MirrorPoint | null, nowMs: number): number {
    if (hip) {
      this.baselineH = this.baselineH === null ? hip.h : Math.max(this.baselineH, hip.h);
      this._depthIn = Math.max(0, this.baselineH - hip.h);
      this.lastSeenAt = nowMs;
    } else if (this.lastSeenAt !== null && nowMs - this.lastSeenAt >= this.resetMs) {
      this.reset();
    }
    return this._depthIn;
  }

  isNearStanding(): boolean {
    return this._depthIn <= STANDING_DEPTH_EPS_IN;
  }
}

function cloneLandmarks(landmarks: readonly PoseLandmark[]): PoseLandmark[] {
  return landmarks.map((landmark) => ({ ...landmark }));
}

/**
 * Frozen standing posture used for torso and legs. Refreshed while the viewer
 * is near standing so the wireframe does not stick to every body wobble.
 */
export class ReferencePoseTracker {
  private reference: PoseLandmark[] | null = null;

  get pose(): readonly PoseLandmark[] | null {
    return this.reference;
  }

  update(live: readonly PoseLandmark[] | null, nearStanding: boolean): readonly PoseLandmark[] | null {
    if (!live?.length) return this.reference;
    if (nearStanding || this.reference === null) {
      this.reference = cloneLandmarks(live);
    }
    return this.reference;
  }
}

function dist2d(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function add2d(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub2d(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale2d(v: Point2D, scale: number): Point2D {
  return { x: v.x * scale, y: v.y * scale };
}

function unit2d(v: Point2D): Point2D | null {
  const len = Math.hypot(v.x, v.y);
  if (len <= 1e-9) return null;
  return { x: v.x / len, y: v.y / len };
}

function pointOf(landmark: PoseLandmark | undefined): Point2D | null {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
  return { x: landmark.x, y: landmark.y };
}

function setPoint(
  landmarks: PoseLandmark[],
  name: PoseLandmarkName,
  point: Point2D,
  template: PoseLandmark,
): void {
  const index = POSE_LANDMARK_INDEX[name];
  landmarks[index] = { ...template, x: point.x, y: point.y };
}

type ArmSide = 'left' | 'right';

const ARM_BY_SIDE: Record<
  ArmSide,
  { shoulder: PoseLandmarkName; elbow: PoseLandmarkName; wrist: PoseLandmarkName; distal: PoseLandmarkName[] }
> = {
  left: {
    shoulder: 'leftShoulder',
    elbow: 'leftElbow',
    wrist: 'leftWrist',
    distal: ['leftPinky', 'leftIndex', 'leftThumb'],
  },
  right: {
    shoulder: 'rightShoulder',
    elbow: 'rightElbow',
    wrist: 'rightWrist',
    distal: ['rightPinky', 'rightIndex', 'rightThumb'],
  },
};

const TORSO_LANDMARKS: readonly PoseLandmarkName[] = [
  'nose',
  'leftEye',
  'rightEye',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];

function shapeArm(
  reference: readonly PoseLandmark[],
  live: readonly PoseLandmark[],
  side: ArmSide,
  armLengthGain: number,
  out: PoseLandmark[],
): void {
  const names = ARM_BY_SIDE[side];
  const refShoulder = pointOf(getLandmark(reference, names.shoulder));
  const liveShoulder = pointOf(getLandmark(live, names.shoulder));
  const liveElbow = pointOf(getLandmark(live, names.elbow));
  const liveWrist = pointOf(getLandmark(live, names.wrist));
  if (!refShoulder || !liveShoulder || !liveElbow || !liveWrist) return;

  const upperDir = unit2d(sub2d(liveElbow, liveShoulder));
  const foreDir = unit2d(sub2d(liveWrist, liveElbow));
  if (!upperDir || !foreDir) return;

  const upperLen = dist2d(liveShoulder, liveElbow) * armLengthGain;
  const foreLen = dist2d(liveElbow, liveWrist) * armLengthGain;
  const elbow = add2d(refShoulder, scale2d(upperDir, upperLen));
  const wrist = add2d(elbow, scale2d(foreDir, foreLen));

  const elbowTemplate = getLandmark(reference, names.elbow) ?? getLandmark(live, names.elbow)!;
  const wristTemplate = getLandmark(reference, names.wrist) ?? getLandmark(live, names.wrist)!;
  setPoint(out, names.elbow, elbow, elbowTemplate);
  setPoint(out, names.wrist, wrist, wristTemplate);

  const liveWristPoint = liveWrist;
  for (const distalName of names.distal) {
    const liveDistal = pointOf(getLandmark(live, distalName));
    if (!liveDistal) continue;
    const offset = sub2d(liveDistal, liveWristPoint);
    const scaled = scale2d(offset, armLengthGain);
    const template = getLandmark(reference, distalName) ?? getLandmark(live, distalName)!;
    setPoint(out, distalName, add2d(wrist, scaled), template);
  }
}

/**
 * Torso and legs stay on the frozen reference. Arms follow live bend and reach
 * with each segment scaled to `armLengthGain` times the user's measured length
 * so the wireframe tracks arm motion but sits larger and away from the torso.
 */
export function buildDecoupledPoseLandmarks(
  reference: readonly PoseLandmark[],
  live: readonly PoseLandmark[],
  armLengthGain: number,
): PoseLandmark[] {
  const out = cloneLandmarks(reference);
  for (const name of TORSO_LANDMARKS) {
    const ref = getLandmark(reference, name);
    if (ref) setPoint(out, name, { x: ref.x, y: ref.y }, ref);
  }
  const gain = Number.isFinite(armLengthGain) && armLengthGain > 0 ? armLengthGain : 1;
  shapeArm(reference, live, 'left', gain, out);
  shapeArm(reference, live, 'right', gain, out);
  return out;
}

/** Per-hand previous sample for finger motion deltas (normalized image space). */
export class FingerMotionTracker {
  private previous = new Map<string, Point2D[]>();

  reset(): void {
    this.previous.clear();
  }

  /**
   * Apply finger movement deltas on top of the shaped wrist. Each joint moves
   * by how much it moved since the last frame, scaled by `motionGain`.
   */
  apply(hands: readonly TrackedHand[], shapedPose: readonly PoseLandmark[], motionGain: number): TrackedHand[] {
    const gain = Number.isFinite(motionGain) && motionGain > 0 ? motionGain : 1;
    return hands.map((hand) => {
      const side = hand.handedness === 'Left' ? 'left' : hand.handedness === 'Right' ? 'right' : null;
      const wristName = side === 'left' ? 'leftWrist' : side === 'right' ? 'rightWrist' : null;
      const shapedWrist = wristName ? pointOf(getLandmark(shapedPose, wristName)) : null;
      const liveWrist = hand.landmarks[0];
      if (!shapedWrist || !liveWrist) return hand;

      const prevKey = hand.handedness ?? 'unknown';
      const prev = this.previous.get(prevKey);

      const landmarks = hand.landmarks.map((landmark, index) => {
        if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return landmark;
        const live = { x: landmark.x, y: landmark.y };
        let motion = { x: 0, y: 0 };
        if (prev?.[index]) {
          motion = sub2d(live, prev[index]!);
        }
        const offsetFromWrist = sub2d(live, { x: liveWrist.x, y: liveWrist.y });
        const base = add2d(shapedWrist, scale2d(offsetFromWrist, gain));
        const next = add2d(base, scale2d(motion, gain));
        return { ...landmark, x: next.x, y: next.y };
      });

      this.previous.set(
        prevKey,
        hand.landmarks.map((landmark) =>
          landmark && Number.isFinite(landmark.x) && Number.isFinite(landmark.y)
            ? { x: landmark.x, y: landmark.y }
            : { x: 0, y: 0 },
        ),
      );

      return { ...hand, landmarks };
    });
  }
}

export interface DecoupledWireframeResult {
  landmarks: readonly PoseLandmark[] | null;
  extraDropIn: number;
}

/**
 * Stateful decoupled wireframe: squat-driven vertical shift, frozen torso,
 * arm-length-scaled limbs, and finger motion on shaped wrists.
 */
export class DecoupledWireframeSession {
  private readonly squat = new SquatDepthTracker();
  private readonly reference = new ReferencePoseTracker();
  private readonly fingers = new FingerMotionTracker();

  constructor(private readonly geometry: MirrorGeometry) {}

  reset(): void {
    this.squat.reset();
    this.reference.update(null, true);
    this.fingers.reset();
  }

  update(
    live: readonly PoseLandmark[] | null | undefined,
    frame: FrameSize | null,
    distanceIn: number,
    nowMs: number,
  ): DecoupledWireframeResult {
    const hip = live && frame ? estimateHipMidpointBody(live, frame, this.geometry, distanceIn) : null;
    const depthIn = this.squat.update(hip, nowMs);
    const gain = this.geometry.wireframeScale > 0 ? this.geometry.wireframeScale : 1.5;
    const extraDropIn = squatDepthExtraDropIn(depthIn, gain);
    const ref = this.reference.update(live ?? null, this.squat.isNearStanding());
    if (!ref || !live?.length) {
      return { landmarks: ref, extraDropIn };
    }
    const landmarks = buildDecoupledPoseLandmarks(ref, live, gain);
    return { landmarks, extraDropIn };
  }

  shapeHands(hands: readonly TrackedHand[], shapedPose: readonly PoseLandmark[]): TrackedHand[] {
    const gain = this.geometry.wireframeScale > 0 ? this.geometry.wireframeScale : 1.5;
    return this.fingers.apply(hands, shapedPose, gain);
  }
}
