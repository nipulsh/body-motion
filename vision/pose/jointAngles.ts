import { VISION_CONFIG } from '../config';
import { angleAtVertex, distance3D } from '../math/angles';
import type {
  JointAngleReading,
  JointAnglesSnapshot,
  JointAngleUnavailableReason,
  PoseLandmark,
  PoseResult,
  TrackableJointName,
  Vec3,
} from '../types';
import { getLandmark, type PoseLandmarkName } from './landmarks';

const TRACKABLE_JOINTS: readonly TrackableJointName[] = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'neck',
  'spine',
] as const;

interface LandmarkTripletDefinition {
  kind: 'triplet';
  a: PoseLandmarkName;
  b: PoseLandmarkName;
  c: PoseLandmarkName;
  /** When set, the middle landmark must be closer to this shoulder than the opposite one. */
  sideAnchor?: PoseLandmarkName;
  oppositeAnchor?: PoseLandmarkName;
}

interface ComputedTripletDefinition {
  kind: 'computed';
  required: readonly PoseLandmarkName[];
  compute: (landmarks: readonly PoseLandmark[]) => { a: Vec3; b: Vec3; c: Vec3 } | null;
}

type JointDefinition = LandmarkTripletDefinition | ComputedTripletDefinition;

function midpoint(a: PoseLandmark, b: PoseLandmark): Vec3 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function toVec3(landmark: PoseLandmark): Vec3 {
  return { x: landmark.x, y: landmark.y, z: landmark.z };
}

function meanVisibility(landmarks: Array<PoseLandmark | undefined>): number {
  const visible = landmarks.filter((lm): lm is PoseLandmark => Boolean(lm));
  if (visible.length === 0) return 0;
  return visible.reduce((sum, lm) => sum + lm.visibility, 0) / visible.length;
}

const JOINT_DEFINITIONS: Record<TrackableJointName, JointDefinition> = {
  left_elbow: {
    kind: 'triplet',
    a: 'leftShoulder',
    b: 'leftElbow',
    c: 'leftWrist',
    sideAnchor: 'leftShoulder',
    oppositeAnchor: 'rightShoulder',
  },
  right_elbow: {
    kind: 'triplet',
    a: 'rightShoulder',
    b: 'rightElbow',
    c: 'rightWrist',
    sideAnchor: 'rightShoulder',
    oppositeAnchor: 'leftShoulder',
  },
  left_shoulder: {
    kind: 'triplet',
    a: 'leftHip',
    b: 'leftShoulder',
    c: 'leftElbow',
    sideAnchor: 'leftShoulder',
    oppositeAnchor: 'rightShoulder',
  },
  right_shoulder: {
    kind: 'triplet',
    a: 'rightHip',
    b: 'rightShoulder',
    c: 'rightElbow',
    sideAnchor: 'rightShoulder',
    oppositeAnchor: 'leftShoulder',
  },
  left_wrist: {
    kind: 'triplet',
    a: 'leftElbow',
    b: 'leftWrist',
    c: 'leftIndex',
    sideAnchor: 'leftShoulder',
    oppositeAnchor: 'rightShoulder',
  },
  right_wrist: {
    kind: 'triplet',
    a: 'rightElbow',
    b: 'rightWrist',
    c: 'rightIndex',
    sideAnchor: 'rightShoulder',
    oppositeAnchor: 'leftShoulder',
  },
  left_hip: {
    kind: 'triplet',
    a: 'leftShoulder',
    b: 'leftHip',
    c: 'leftKnee',
    sideAnchor: 'leftHip',
    oppositeAnchor: 'rightHip',
  },
  right_hip: {
    kind: 'triplet',
    a: 'rightShoulder',
    b: 'rightHip',
    c: 'rightKnee',
    sideAnchor: 'rightHip',
    oppositeAnchor: 'leftHip',
  },
  left_knee: {
    kind: 'triplet',
    a: 'leftHip',
    b: 'leftKnee',
    c: 'leftAnkle',
    sideAnchor: 'leftHip',
    oppositeAnchor: 'rightHip',
  },
  right_knee: {
    kind: 'triplet',
    a: 'rightHip',
    b: 'rightKnee',
    c: 'rightAnkle',
    sideAnchor: 'rightHip',
    oppositeAnchor: 'leftHip',
  },
  left_ankle: {
    kind: 'triplet',
    a: 'leftKnee',
    b: 'leftAnkle',
    c: 'leftFootIndex',
    sideAnchor: 'leftAnkle',
    oppositeAnchor: 'rightAnkle',
  },
  right_ankle: {
    kind: 'triplet',
    a: 'rightKnee',
    b: 'rightAnkle',
    c: 'rightFootIndex',
    sideAnchor: 'rightAnkle',
    oppositeAnchor: 'leftAnkle',
  },
  neck: {
    kind: 'triplet',
    a: 'leftShoulder',
    b: 'nose',
    c: 'rightShoulder',
  },
  spine: {
    kind: 'computed',
    required: ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
    compute: (landmarks) => {
      const leftShoulder = getLandmark(landmarks, 'leftShoulder');
      const rightShoulder = getLandmark(landmarks, 'rightShoulder');
      const leftHip = getLandmark(landmarks, 'leftHip');
      const rightHip = getLandmark(landmarks, 'rightHip');
      const leftKnee = getLandmark(landmarks, 'leftKnee');
      const rightKnee = getLandmark(landmarks, 'rightKnee');
      if (!leftShoulder || !rightShoulder || !leftHip || !rightHip || !leftKnee || !rightKnee) {
        return null;
      }
      return {
        a: midpoint(leftShoulder, rightShoulder),
        b: midpoint(leftHip, rightHip),
        c: midpoint(leftKnee, rightKnee),
      };
    },
  },
};

export interface JointAngleOptions {
  minimumLandmarkVisibility?: number;
  maxAngleJumpDeg?: number;
  minimumSegmentLength?: number;
  previousAngles?: Partial<Record<TrackableJointName, number>>;
}

function unavailable(reason: JointAngleUnavailableReason, confidence?: number): JointAngleReading {
  return confidence === undefined
    ? { available: false, reason }
    : { available: false, reason, confidence };
}

function resolveLandmarkSet(pose: PoseResult): {
  landmarks: readonly PoseLandmark[];
  coordinateSpace: 'world' | 'image';
} {
  if (pose.worldLandmarks && pose.worldLandmarks.length >= 33) {
    return { landmarks: pose.worldLandmarks, coordinateSpace: 'world' };
  }
  return { landmarks: pose.landmarks, coordinateSpace: 'image' };
}

function hasMinimumSegmentLength(a: Vec3, b: Vec3, c: Vec3, minimumLength: number): boolean {
  return (
    distance3D(a, b) >= minimumLength &&
    distance3D(b, c) >= minimumLength &&
    distance3D(a, c) >= minimumLength
  );
}

function passesSideConsistency(
  middle: PoseLandmark,
  sideAnchor: PoseLandmark,
  oppositeAnchor: PoseLandmark,
  ratioLimit: number,
): boolean {
  const toSide = distance3D(middle, sideAnchor);
  const toOpposite = distance3D(middle, oppositeAnchor);
  if (toSide === 0) return false;
  // Middle landmark should be materially closer to its anatomical side anchor.
  return toSide * ratioLimit <= toOpposite;
}

function computeTripletReading(
  a: PoseLandmark,
  b: PoseLandmark,
  c: PoseLandmark,
  options: Required<JointAngleOptions>,
  previousAngle?: number,
): JointAngleReading {
  const confidence = meanVisibility([a, b, c]);
  if (confidence < options.minimumLandmarkVisibility) {
    return unavailable('LOW_CONFIDENCE', confidence);
  }

  const aVec = toVec3(a);
  const bVec = toVec3(b);
  const cVec = toVec3(c);

  if (!hasMinimumSegmentLength(aVec, bVec, cVec, options.minimumSegmentLength)) {
    return unavailable('INVALID_GEOMETRY', confidence);
  }

  const angle = angleAtVertex(aVec, bVec, cVec);
  if (!Number.isFinite(angle)) {
    return unavailable('INVALID_GEOMETRY', confidence);
  }

  if (previousAngle !== undefined) {
    const delta = Math.abs(angle - previousAngle);
    if (delta > options.maxAngleJumpDeg) {
      return unavailable('SUDDEN_JUMP', confidence);
    }
  }

  return {
    available: true,
    angle: Math.round(angle * 10) / 10,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}

function computeJointReading(
  joint: TrackableJointName,
  landmarks: readonly PoseLandmark[],
  options: Required<JointAngleOptions>,
  previousAngle?: number,
): JointAngleReading {
  const definition = JOINT_DEFINITIONS[joint];

  if (definition.kind === 'computed') {
    for (const name of definition.required) {
      const lm = getLandmark(landmarks, name);
      if (!lm || lm.visibility < options.minimumLandmarkVisibility) {
        return unavailable('MISSING_LANDMARK', lm?.visibility);
      }
    }

    const triplet = definition.compute(landmarks);
    if (!triplet) {
      return unavailable('MISSING_LANDMARK');
    }

    const requiredLandmarks = definition.required.map((name) => getLandmark(landmarks, name));
    const confidence = meanVisibility(requiredLandmarks);
    if (confidence < options.minimumLandmarkVisibility) {
      return unavailable('LOW_CONFIDENCE', confidence);
    }

    if (!hasMinimumSegmentLength(triplet.a, triplet.b, triplet.c, options.minimumSegmentLength)) {
      return unavailable('INVALID_GEOMETRY', confidence);
    }

    const angle = angleAtVertex(triplet.a, triplet.b, triplet.c);
    if (!Number.isFinite(angle)) {
      return unavailable('INVALID_GEOMETRY', confidence);
    }

    if (previousAngle !== undefined && Math.abs(angle - previousAngle) > options.maxAngleJumpDeg) {
      return unavailable('SUDDEN_JUMP', confidence);
    }

    return {
      available: true,
      angle: Math.round(angle * 10) / 10,
      confidence: Math.round(confidence * 1000) / 1000,
    };
  }

  const a = getLandmark(landmarks, definition.a);
  const b = getLandmark(landmarks, definition.b);
  const c = getLandmark(landmarks, definition.c);

  if (!a || !b || !c) {
    return unavailable('MISSING_LANDMARK', meanVisibility([a, b, c]));
  }

  if (
    a.visibility < options.minimumLandmarkVisibility ||
    b.visibility < options.minimumLandmarkVisibility ||
    c.visibility < options.minimumLandmarkVisibility
  ) {
    return unavailable('LOW_CONFIDENCE', meanVisibility([a, b, c]));
  }

  const aVec = toVec3(a);
  const bVec = toVec3(b);
  const cVec = toVec3(c);
  if (!hasMinimumSegmentLength(aVec, bVec, cVec, options.minimumSegmentLength)) {
    return unavailable('INVALID_GEOMETRY', meanVisibility([a, b, c]));
  }

  if (definition.sideAnchor && definition.oppositeAnchor) {
    const sideAnchor = getLandmark(landmarks, definition.sideAnchor);
    const oppositeAnchor = getLandmark(landmarks, definition.oppositeAnchor);
    if (sideAnchor && oppositeAnchor) {
      const ratioLimit = VISION_CONFIG.jointAngles.sideConfusionRatio;
      // Shoulder, hip, and ankle use the joint itself as the side anchor, so the
      // vertex-to-anchor distance is 0 and the check always failed. Compare the
      // distal landmark (elbow, knee, foot) instead.
      const subject = distance3D(toVec3(b), toVec3(sideAnchor)) < 1e-4 ? c : b;
      if (!passesSideConsistency(subject, sideAnchor, oppositeAnchor, ratioLimit)) {
        return unavailable('LANDMARK_CONFUSION', meanVisibility([a, b, c]));
      }
    }
  }

  return computeTripletReading(a, b, c, options, previousAngle);
}

function resolveOptions(options?: JointAngleOptions): Required<JointAngleOptions> {
  return {
    minimumLandmarkVisibility:
      options?.minimumLandmarkVisibility ?? VISION_CONFIG.jointAngles.minimumLandmarkVisibility,
    maxAngleJumpDeg: options?.maxAngleJumpDeg ?? VISION_CONFIG.jointAngles.maxAngleJumpDeg,
    minimumSegmentLength:
      options?.minimumSegmentLength ?? VISION_CONFIG.jointAngles.minimumSegmentLength,
    previousAngles: options?.previousAngles ?? {},
  };
}

/** Calculate standardized joint angles from a pose result. Deterministic — no Gemini calls. */
export function calculateJointAngles(
  pose: PoseResult,
  options?: JointAngleOptions,
): JointAnglesSnapshot {
  const resolved = resolveOptions(options);
  const { landmarks, coordinateSpace } = resolveLandmarkSet(pose);

  const joints = {} as Record<TrackableJointName, JointAngleReading>;
  for (const joint of TRACKABLE_JOINTS) {
    joints[joint] = computeJointReading(
      joint,
      landmarks,
      resolved,
      resolved.previousAngles[joint],
    );
  }

  return {
    timestamp: pose.timestamp,
    coordinateSpace,
    joints,
  };
}

/** Stateful wrapper that tracks previous angles for sudden-jump rejection. */
export class JointAngleCalculator {
  private previous: Partial<Record<TrackableJointName, number>> = {};

  calculate(pose: PoseResult, options?: Omit<JointAngleOptions, 'previousAngles'>): JointAnglesSnapshot {
    const snapshot = calculateJointAngles(pose, {
      ...options,
      previousAngles: this.previous,
    });

    const nextPrevious: Partial<Record<TrackableJointName, number>> = {};
    for (const joint of TRACKABLE_JOINTS) {
      const reading = snapshot.joints[joint];
      if (reading.available) {
        nextPrevious[joint] = reading.angle;
      }
    }
    this.previous = nextPrevious;
    return snapshot;
  }

  reset(): void {
    this.previous = {};
  }
}

export { TRACKABLE_JOINTS };
