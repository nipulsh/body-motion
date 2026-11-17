import { angleAtVertex } from '../math/angles';
import {
  BodyAxisTracker,
  fromVerticalDeg,
  LandmarkSpace,
  lineTilt,
  midpoint,
  resolveBodyUp,
  sideComponent,
  upComponent,
  type BodyAxis,
  type BodySide,
} from '../exercise/formCommon';
import type { PoseResult, Vec3 } from '../types';
import type { PoseLandmarkName } from './landmarks';

/**
 * Objective posture measurements from scan frames, sent with the images so the analysis
 * names the body part that actually deviates (a bent knee is a knee finding, not a
 * shoulder one). Every angle is either a joint angle between two body segments or is taken
 * against the body's own up axis (perpendicular to the feet), so camera roll does not move it.
 */

/** Muscle-group vocabulary shared with the server muscle catalogue. */
export type PostureMuscleGroup =
  | 'HEAD_NECK'
  | 'SHOULDER'
  | 'UPPER_ARM'
  | 'FOREARM'
  | 'CHEST'
  | 'BACK'
  | 'ABDOMEN'
  | 'HIP'
  | 'UPPER_LEG'
  | 'LOWER_LEG';

export type PostureRegion =
  | 'head_neck'
  | 'shoulder'
  | 'elbow'
  | 'trunk'
  | 'pelvis_hip'
  | 'knee'
  | 'leg';

export interface PostureFinding {
  region: PostureRegion;
  side: 'left' | 'right' | 'bilateral' | 'midline';
  metric: string;
  /** Median measured value (degrees, or percent for ratios). */
  value: number;
  unit: 'deg' | 'percent';
  /** Value at which the deviation becomes notable. */
  threshold: number;
  /** value / threshold. ≥ 1 is a finding; larger is more pronounced. */
  severity: number;
  /** Catalogue muscle groups that act on this region. */
  muscleGroups: PostureMuscleGroup[];
  description: string;
}

export interface PostureMetricsSummary {
  version: 1;
  /** Frames with a usable pose. */
  frameCount: number;
  frontalFrames: number;
  sideFrames: number;
  /** Median of every measured metric (see METRIC_INFO for meaning and sign). */
  metrics: Record<string, number>;
  /** Notable deviations, most pronounced first. */
  findings: PostureFinding[];
}

interface MetricInfo {
  region: PostureRegion;
  threshold: number;
  unit: 'deg' | 'percent';
  muscleGroups: PostureMuscleGroup[];
  /** Signed metrics: positive points at the left side (see `describe`). */
  signed: boolean;
  /** Side for unsigned per-side metrics. */
  side?: BodySide;
  describe: (value: number) => string;
}

const sideWord = (value: number) => (value > 0 ? 'left' : 'right');
const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Thresholds are conservative clinical-screening values for relaxed standing. Per-side knee
 * flexion uses a wider band than the left–right difference because MediaPipe depth adds a
 * few degrees of bend to a straight leg on both sides alike.
 */
export const METRIC_INFO: Record<string, MetricInfo> = {
  headTiltDeg: {
    region: 'head_neck', threshold: 4, unit: 'deg', muscleGroups: ['HEAD_NECK'], signed: true,
    describe: (v) => `Head tilted ${round(Math.abs(v))}° toward the ${sideWord(v)} (eye line vs body horizontal)`,
  },
  forwardHeadDeg: {
    region: 'head_neck', threshold: 15, unit: 'deg', muscleGroups: ['HEAD_NECK', 'BACK'], signed: false,
    describe: (v) => `Forward head posture: ear ${round(v)}° ahead of the shoulder (side view)`,
  },
  shoulderTiltDeg: {
    region: 'shoulder', threshold: 3, unit: 'deg', muscleGroups: ['SHOULDER', 'BACK', 'HEAD_NECK'], signed: true,
    describe: (v) => `${sideWord(v) === 'left' ? 'Left' : 'Right'} shoulder sits lower (shoulder line ${round(Math.abs(v))}° off level)`,
  },
  shoulderElevationAsymmetryPct: {
    region: 'shoulder', threshold: 10, unit: 'percent', muscleGroups: ['SHOULDER', 'HEAD_NECK'], signed: true,
    describe: (v) => `${sideWord(v) === 'left' ? 'Left' : 'Right'} shoulder hitched toward the ear (${round(Math.abs(v))}% of shoulder width)`,
  },
  leftElbowFlexionDeg: {
    region: 'elbow', threshold: 25, unit: 'deg', muscleGroups: ['UPPER_ARM', 'FOREARM'], signed: false, side: 'left',
    describe: (v) => `Left elbow held bent ${round(v)}° at rest`,
  },
  rightElbowFlexionDeg: {
    region: 'elbow', threshold: 25, unit: 'deg', muscleGroups: ['UPPER_ARM', 'FOREARM'], signed: false, side: 'right',
    describe: (v) => `Right elbow held bent ${round(v)}° at rest`,
  },
  trunkLateralLeanDeg: {
    region: 'trunk', threshold: 4, unit: 'deg', muscleGroups: ['BACK', 'ABDOMEN'], signed: true,
    describe: (v) => `Trunk leans ${round(Math.abs(v))}° toward the ${sideWord(v)}`,
  },
  trunkForwardLeanDeg: {
    region: 'trunk', threshold: 10, unit: 'deg', muscleGroups: ['BACK', 'ABDOMEN', 'HIP'], signed: false,
    describe: (v) => `Trunk pitched ${round(v)}° forward (side view)`,
  },
  pelvisTiltDeg: {
    region: 'pelvis_hip', threshold: 3, unit: 'deg', muscleGroups: ['HIP', 'BACK', 'ABDOMEN'], signed: true,
    describe: (v) => `${sideWord(v) === 'left' ? 'Left' : 'Right'} hip sits lower (pelvis ${round(Math.abs(v))}° off level)`,
  },
  leftHipFlexionDeg: {
    region: 'pelvis_hip', threshold: 15, unit: 'deg', muscleGroups: ['HIP', 'UPPER_LEG'], signed: false, side: 'left',
    describe: (v) => `Left hip held flexed ${round(v)}°`,
  },
  rightHipFlexionDeg: {
    region: 'pelvis_hip', threshold: 15, unit: 'deg', muscleGroups: ['HIP', 'UPPER_LEG'], signed: false, side: 'right',
    describe: (v) => `Right hip held flexed ${round(v)}°`,
  },
  leftKneeFlexionDeg: {
    region: 'knee', threshold: 15, unit: 'deg', muscleGroups: ['UPPER_LEG', 'LOWER_LEG'], signed: false, side: 'left',
    describe: (v) => `Left knee held bent ${round(v)}° while standing`,
  },
  rightKneeFlexionDeg: {
    region: 'knee', threshold: 15, unit: 'deg', muscleGroups: ['UPPER_LEG', 'LOWER_LEG'], signed: false, side: 'right',
    describe: (v) => `Right knee held bent ${round(v)}° while standing`,
  },
  kneeFlexionAsymmetryDeg: {
    region: 'knee', threshold: 8, unit: 'deg', muscleGroups: ['UPPER_LEG', 'LOWER_LEG', 'HIP'], signed: true,
    describe: (v) => `${sideWord(v) === 'left' ? 'Left' : 'Right'} knee bent ${round(Math.abs(v))}° more than the other`,
  },
  leftKneeValgusDeg: {
    region: 'knee', threshold: 8, unit: 'deg', muscleGroups: ['UPPER_LEG', 'HIP', 'LOWER_LEG'], signed: false, side: 'left',
    describe: (v) => (v >= 0 ? `Left knee drifts inward (valgus) ${round(v)}°` : `Left knee bows outward (varus) ${round(-v)}°`),
  },
  rightKneeValgusDeg: {
    region: 'knee', threshold: 8, unit: 'deg', muscleGroups: ['UPPER_LEG', 'HIP', 'LOWER_LEG'], signed: false, side: 'right',
    describe: (v) => (v >= 0 ? `Right knee drifts inward (valgus) ${round(v)}°` : `Right knee bows outward (varus) ${round(-v)}°`),
  },
  legLengthDifferencePct: {
    region: 'leg', threshold: 4, unit: 'percent', muscleGroups: ['HIP', 'UPPER_LEG', 'LOWER_LEG'], signed: true,
    describe: (v) => `${sideWord(v) === 'left' ? 'Left' : 'Right'} leg appears ${round(Math.abs(v))}% shorter (hip-to-ankle, camera plane)`,
  },
};

const MIN_VISIBILITY = 0.5;

type FrameMetrics = Partial<Record<keyof typeof METRIC_INFO, number>>;

function flexion(space: LandmarkSpace, a: PoseLandmarkName, b: PoseLandmarkName, c: PoseLandmarkName): number | undefined {
  const pa = space.get(a);
  const pb = space.get(b);
  const pc = space.get(c);
  if (!pa || !pb || !pc) return undefined;
  const interior = angleAtVertex(pa, pb, pc);
  return Number.isFinite(interior) ? 180 - interior : undefined;
}

/** Signed frontal knee angle in the camera plane: positive when the knee sits medial (valgus). */
function kneeValgus(space: LandmarkSpace, side: BodySide, up: BodyAxis): number | undefined {
  const prefix = side === 'left' ? 'left' : 'right';
  const hip = space.pixel(`${prefix}Hip` as PoseLandmarkName);
  const knee = space.pixel(`${prefix}Knee` as PoseLandmarkName);
  const ankle = space.pixel(`${prefix}Ankle` as PoseLandmarkName);
  const otherHip = space.pixel(`${side === 'left' ? 'right' : 'left'}Hip` as PoseLandmarkName);
  if (!hip || !knee || !ankle || !otherHip) return undefined;
  const interior = angleAtVertex(hip, knee, ankle);
  if (!Number.isFinite(interior)) return undefined;
  const bend = 180 - interior;
  // Where the knee sits relative to the hip→ankle line, measured toward the body midline.
  const lineMid = midpoint(hip, ankle);
  const midline = midpoint(hip, otherHip);
  const towardMidline = Math.sign(sideComponent(hip, midline, up)) || 1;
  const offset = sideComponent(lineMid, knee, up) * towardMidline;
  return offset >= 0 ? bend : -bend;
}

function measureFrame(pose: PoseResult, axis: BodyAxisTracker): { view: 'front' | 'side' | 'other'; metrics: FrameMetrics } | null {
  const space = new LandmarkSpace(pose, pose.frameAspect ?? 16 / 9, MIN_VISIBILITY);
  const ls = space.pixel('leftShoulder');
  const rs = space.pixel('rightShoulder');
  const lh = space.pixel('leftHip');
  const rh = space.pixel('rightHip');
  if (!ls || !rs || !lh || !rh) return null;
  const torso = Math.hypot(midpoint(ls, rs).x - midpoint(lh, rh).x, midpoint(ls, rs).y - midpoint(lh, rh).y);
  if (torso <= 0) return null;
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const ratio = shoulderWidth / torso;
  // From behind, MediaPipe often still guesses a face and swaps left and right. A real face
  // is in front of the shoulders (smaller z, toward the camera); a guessed one is not.
  // Metric world depth is used when present: image-space z is a rough relative estimate.
  const depth = pose.worldLandmarks && pose.worldLandmarks.length >= 33 ? pose.worldLandmarks : pose.landmarks;
  const nose = depth[0];
  const lShoulder = depth[11];
  const rShoulder = depth[12];
  const facingCamera =
    space.visibility('nose') >= MIN_VISIBILITY &&
    nose !== undefined &&
    lShoulder !== undefined &&
    rShoulder !== undefined &&
    nose.z <= (lShoulder.z + rShoulder.z) / 2;
  const view: 'front' | 'side' | 'other' =
    ratio >= 0.55 ? (facingCamera ? 'front' : 'other') : ratio <= 0.35 ? 'side' : 'other';

  const metrics: FrameMetrics = {};
  // Joint angles between body segments hold in any view and any camera roll.
  const put = (key: keyof typeof METRIC_INFO, value: number | undefined) => {
    if (value !== undefined && Number.isFinite(value)) metrics[key] = value;
  };
  const leftKnee = flexion(space, 'leftHip', 'leftKnee', 'leftAnkle');
  const rightKnee = flexion(space, 'rightHip', 'rightKnee', 'rightAnkle');
  put('leftKneeFlexionDeg', leftKnee);
  put('rightKneeFlexionDeg', rightKnee);
  if (leftKnee !== undefined && rightKnee !== undefined) put('kneeFlexionAsymmetryDeg', leftKnee - rightKnee);
  put('leftHipFlexionDeg', flexion(space, 'leftShoulder', 'leftHip', 'leftKnee'));
  put('rightHipFlexionDeg', flexion(space, 'rightShoulder', 'rightHip', 'rightKnee'));
  put('leftElbowFlexionDeg', flexion(space, 'leftShoulder', 'leftElbow', 'leftWrist'));
  put('rightElbowFlexionDeg', flexion(space, 'rightShoulder', 'rightElbow', 'rightWrist'));

  if (view === 'front') {
    const { up } = resolveBodyUp(space, 'front', 'left', axis);
    const le = space.pixel('leftEye');
    const re = space.pixel('rightEye');
    const signedTilt = (left: Vec3, right: Vec3) => {
      const tilt = lineTilt(left, right, up);
      return tilt.toward === 'left' ? tilt.deg : -tilt.deg;
    };
    if (le && re) put('headTiltDeg', signedTilt(le, re));
    put('shoulderTiltDeg', signedTilt(ls, rs));
    put('pelvisTiltDeg', signedTilt(lh, rh));
    const hipMid = midpoint(lh, rh);
    const shoulderMid = midpoint(ls, rs);
    const lean = fromVerticalDeg(hipMid, shoulderMid, up);
    const leansLeft = Math.sign(sideComponent(hipMid, shoulderMid, up)) === Math.sign(sideComponent(rh, lh, up));
    put('trunkLateralLeanDeg', leansLeft ? lean : -lean);
    const lEar = space.pixel('leftEar');
    const rEar = space.pixel('rightEar');
    if (lEar && rEar && shoulderWidth > 0) {
      const leftGap = upComponent(ls, lEar, up);
      const rightGap = upComponent(rs, rEar, up);
      // A hitched shoulder closes the gap to its ear.
      put('shoulderElevationAsymmetryPct', ((rightGap - leftGap) / shoulderWidth) * 100);
    }
    put('leftKneeValgusDeg', kneeValgus(space, 'left', up));
    put('rightKneeValgusDeg', kneeValgus(space, 'right', up));
    const la = space.pixel('leftAnkle');
    const ra = space.pixel('rightAnkle');
    if (la && ra) {
      const leftLeg = Math.hypot(lh.x - la.x, lh.y - la.y);
      const rightLeg = Math.hypot(rh.x - ra.x, rh.y - ra.y);
      const mean = (leftLeg + rightLeg) / 2;
      if (mean > 0) put('legLengthDifferencePct', ((rightLeg - leftLeg) / mean) * 100);
    }
  } else if (view === 'side') {
    const near: BodySide =
      space.visibility('leftShoulder') + space.visibility('leftHip') >=
      space.visibility('rightShoulder') + space.visibility('rightHip')
        ? 'left'
        : 'right';
    const { up } = resolveBodyUp(space, 'side', near, axis);
    const shoulder = near === 'left' ? ls : rs;
    const hip = near === 'left' ? lh : rh;
    const ear = space.pixel(near === 'left' ? 'leftEar' : 'rightEar');
    if (ear) put('forwardHeadDeg', fromVerticalDeg(shoulder, ear, up));
    put('trunkForwardLeanDeg', fromVerticalDeg(hip, shoulder, up));
  }
  return { view, metrics };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Aggregate per-frame measurements into medians and ranked findings. Null without usable frames. */
export function summarizePosture(poses: ReadonlyArray<PoseResult | null | undefined>): PostureMetricsSummary | null {
  const axis = new BodyAxisTracker();
  const samples = new Map<string, number[]>();
  let frameCount = 0;
  let frontalFrames = 0;
  let sideFrames = 0;
  for (const pose of poses) {
    if (!pose || pose.landmarks.length < 33) continue;
    const measured = measureFrame(pose, axis);
    if (!measured) continue;
    frameCount += 1;
    if (measured.view === 'front') frontalFrames += 1;
    if (measured.view === 'side') sideFrames += 1;
    for (const [key, value] of Object.entries(measured.metrics)) {
      if (value === undefined) continue;
      const list = samples.get(key) ?? [];
      list.push(value);
      samples.set(key, list);
    }
  }
  if (frameCount === 0) return null;

  const metrics: Record<string, number> = {};
  for (const [key, values] of samples) {
    // A single stray frame is not a posture; require a few agreeing samples.
    if (values.length < Math.min(3, frameCount)) continue;
    metrics[key] = round(median(values));
  }

  const findings: PostureFinding[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    const info = METRIC_INFO[key];
    if (!info) continue;
    const severity = Math.abs(value) / info.threshold;
    if (severity < 1) continue;
    findings.push({
      region: info.region,
      side: info.side ?? (info.signed ? (value > 0 ? 'left' : 'right') : 'bilateral'),
      metric: key,
      value,
      unit: info.unit,
      threshold: info.threshold,
      severity: Math.round(severity * 100) / 100,
      muscleGroups: info.muscleGroups,
      description: info.describe(value),
    });
  }
  findings.sort((a, b) => b.severity - a.severity);

  return { version: 1, frameCount, frontalFrames, sideFrames, metrics, findings };
}
