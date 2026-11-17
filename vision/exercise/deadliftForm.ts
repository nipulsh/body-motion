import { VISION_CONFIG } from '../config';
import { angleAtVertex } from '../math/angles';
import { landmarkSeen, POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import { spineBowScale } from '../pose/wireframe';
import { extractBackContour } from '../posture/BackContourExtractor';
import { initialDeadliftPhaseState, stepDeadliftPhase, type DeadliftPhase, type DeadliftPhaseState } from '../posture/deadliftPhase';
import { assessDeadliftLandmarks } from '../posture/landmarkGate';
import {
  assessNeutralSpineProfile,
  NeutralSpineCalibrator,
  type CalibrationStatus,
  type NeutralSpineProfile,
  type SpineSignalSource,
} from '../posture/NeutralSpineCalibrator';
import { classifyPosture, type ClassifyConfig, type PostureClassification, type RoundingLatch } from '../posture/PostureClassifier';
import { OneEuroFilter, PostureTemporalTracker, RecentMedian } from '../posture/PostureTemporalTracker';
import { bodyYawDeg, sagittalStretch, trunkInclination3dDeg } from '../posture/spinalBiomechanics';
import { analyzeSpineCurvature, type RegionCurvature } from '../posture/SpineCurvatureAnalyzer';
import { estimateSpineCurve, spineCurveFromChain, SpineCurveTracker, type SpineCurve } from '../posture/SpineCurveDetector';
import { UpperBackOutline } from '../posture/UpperBackOutline';
import { measureSpineChain, type SpineChainReading, type SpineChainRejection } from '../spine/spineChain';
import type { PoseResult, Vec3 } from '../types';
import {
  bodyLengthAxis,
  FaultTimer,
  fromVerticalDeg,
  kneeIncludedDeg,
  LandmarkSpace,
  round1,
  ScreenAxisLock,
  sideComponent,
  SIDE_LANDMARKS,
  type BodySide,
  type FormResult,
} from './formCommon';

/** Outline estimates only. These are not a claim that the spine is injured. */
export type DeadliftFaultCode =
  | 'possible_upper_back_rounding'
  | 'possible_lower_back_rounding'
  | 'possible_combined_rounding';

export const DEADLIFT_FAULT_PRIORITY: readonly DeadliftFaultCode[] = [
  'possible_combined_rounding',
  'possible_upper_back_rounding',
  'possible_lower_back_rounding',
];

interface ImagePoint {
  x: number;
  y: number;
}

/**
 * Why the back shape was or was not judged. Camera orientation (`not_side_on`) and landmark
 * visibility (`landmarks_missing`) are separate from the outline. Trunk lean is not a
 * visibility check: hinging does not mean the back left the frame.
 * `outline_unavailable` means the back could not be read this moment: the silhouette could not be
 * traced, or the spine keypoints dropped out. The hip angle still stands, and it is not a request to move.
 */
export type DeadliftBackCheck =
  | 'judged'
  | 'upright'
  | 'no_silhouette'
  | 'not_side_on'
  | 'landmarks_missing'
  | 'outline_unavailable';

export interface DeadliftLandmarkSight {
  visibility: number;
  presence: number | null;
  seen: boolean;
}

/** Camera orientation and landmark visibility for one frame. Independent of trunk lean. */
export interface DeadliftView {
  /** Shoulder width / torso length. Null when the far shoulder or hip is not seen. */
  shoulderToTorso: number | null;
  /** Camera is across the body, about 90° to the sagittal plane. */
  cameraSideOn: boolean;
  /** The side used for the hip angle has a seen shoulder, hip, and knee. */
  landmarksVisible: boolean;
  landmarks: Partial<Record<PoseLandmarkName, DeadliftLandmarkSight>>;
}

export interface BackRegionReading {
  /**
   * Posterior curvature scaled to the hip–shoulder length. Positive bows out of the back.
   * Null when the outline was not published.
   */
  sagitta: number | null;
  confidence: number;
  /** Sagitta minus the standing baseline. Null without a baseline or a reading. */
  delta: number | null;
}

export interface DeadliftFormFrame {
  /** Side facing the camera (deadlift is filmed side-on). */
  side: BodySide;
  /**
   * Four image-space back points, hip first: hip, lower back, mid back, upper back (shoulder).
   * The middle two sit between hip and shoulder, bowed out of the back when a warning is showing.
   */
  back: ImagePoint[];
  /** Ear on the same side. Null when it is not visible. */
  head: ImagePoint | null;
  /** Trunk lean from upright, in degrees. Same quantity as `trunkInclinationDeg`. */
  trunkLeanDeg: number;
  /** Hip→shoulder away from the vertical through the hip: 0° upright, larger as the trunk bends. */
  backAngleDeg: number;
  /** Reference "up" in normalized image coordinates, locked to the screen edges. */
  upImage: ImagePoint;
  /** Posterior outline, hip end first. Empty when it was not read. */
  backEdge: ImagePoint[];
  /**
   * Full-span bulge as a fraction of hip–shoulder length. Negative is a hollow outline.
   * Null when the outline was not read.
   */
  backBulgeRatio: number | null;
  /**
   * Full-span outline turn in degrees. About 0 when flat, positive when the whole outline
   * bows out, negative when it hollows. Display only: rounding uses the two regions.
   */
  backBendDeg: number | null;
  backCheck: DeadliftBackCheck;
  /**
   * What the back shape is being read from. `spinepose` is the model's spine keypoints, and also
   * covers a short dropout of them, when the regions below are simply not published.
   */
  spineSource: SpineSignalSource;
  /** Why keypoints that arrived this frame were not used. Null when they were, or when none arrived. */
  spineRejection: SpineChainRejection | null;
  /** Timestamp of the video frame the keypoints came from. Null when they were not used. */
  spineCapturedAt: number | null;
  /** Side of the trunk line the chest is on, from the landmarks this frame. Null when they could not say. */
  chestSign: ChestSign | null;
  /**
   * How much more bent the spine is than when standing, in degrees, from the keypoints. A spine
   * flatter or more arched than that reads 0°, not a negative bend. Null without keypoints or a baseline.
   */
  spineBendDeltaDeg: number | null;
  /**
   * Turn at T3 between T8 → T3 and T3 → C7, from the keypoints, in degrees. 0 when the three are in
   * a line, positive when the upper back bows out. Null without keypoints.
   */
  upperBackLineDeg: number | null;
  /**
   * How much more the T8–T3–C7 line bends than when standing, in degrees. Straighter than standing
   * reads 0. Null without keypoints or a baseline.
   */
  upperBackLineDeltaDeg: number | null;
  /** The T8–T3–C7 line is past its threshold and is raising the upper-back warning. */
  upperBackLineBent: boolean;
  /**
   * Hip centre → L3 against upright, from the keypoints, in degrees. Positive leans forward. A camera
   * estimate of pelvic tilt, not a radiograph. Null without keypoints.
   */
  pelvicTiltDeg: number | null;
  /** Change in `pelvicTiltDeg` since standing. Positive is anterior tilt. Null without a baseline. */
  pelvicTiltDeltaDeg: number | null;
  /**
   * Hip → shoulder from upright in MediaPipe's 3D world landmarks. Does not shrink when the body
   * turns toward the camera. Null when they are missing or not body-sized.
   */
  trunkInclination3dDeg: number | null;
  /** Turn away from a true side view, from the world landmarks. Null when unknown. */
  bodyYawDeg: number | null;
  /** Stretch applied to the spine keypoints to undo that turn: 1 / cos(yaw). 1 when none. */
  sagittalStretch: number;
  /** The outline's read of the upper back, taken alongside the keypoints. Null when they are not in use. */
  upperOutline: BackRegionReading | null;
  /** One hip–shoulder length straight out of the back. Null when the outline was not read. */
  backOutward: ImagePoint | null;
  /** Image-space shift drawn at mid-back. Zero unless a rounding warning is active. */
  spineBow: ImagePoint;
  /** A regional outline estimate is past the person's baseline. */
  rounded: boolean;
  thoracic: BackRegionReading;
  lumbar: BackRegionReading;
  /**
   * Eight estimated stations from the pelvis to the neck. Not vertebrae.
   * Curvature on this curve is separate from `trunkInclinationDeg`.
   */
  spineCurve: SpineCurve;
  /** Landmark hip→shoulder against the body's up axis. Independent of the outline. */
  trunkInclinationDeg: number;
  /** Included angle at the hip. Null when the knee is not visible. */
  hipAngleDeg: number | null;
  /**
   * How much the hip angle has closed compared with the standing baseline, in degrees.
   * A camera estimate of pelvic orientation, not a sacral measurement. Null without a baseline.
   */
  pelvicOrientationDeg: number | null;
  /** Hip→shoulder offset perpendicular to body up, as a fraction of torso length. */
  hipShoulderOffset: number;
  /** Included knee angle. Null when the ankle is not visible. */
  kneeIncludedDeg: number | null;
  /** Image y of the hip. Smaller is higher in the frame. */
  hipY: number;
  sideOn: boolean;
  phase: DeadliftPhase;
  classification: PostureClassification;
  calibration: CalibrationStatus;
  landmarkConfidence: number;
  worldLandmarksReliable: boolean;
  /** Camera orientation and which spine landmarks were seen. Not derived from trunk lean. */
  view: DeadliftView;
  /** Camera-plane hip, used to smooth inclination. Aspect-corrected x, image y. */
  cameraHip: ImagePoint;
  cameraShoulder: ImagePoint;
  cameraKnee: ImagePoint | null;
  cameraAnkle: ImagePoint | null;
  /** Body up in the same camera plane as `cameraHip`. */
  cameraUp: ImagePoint;
}

export type DeadliftFormResult = FormResult<DeadliftFormFrame, DeadliftFaultCode>;

/** +1 when the chest is on the side of `trunkNormal`, −1 when it is on the other. */
export type ChestSign = 1 | -1;

type DeadliftFormConfig = typeof VISION_CONFIG.deadliftForm;

const SPINE_CHAIN_CONFIG = VISION_CONFIG.spinePose.chain;

const EAR: Record<BodySide, PoseLandmarkName> = { left: 'leftEar', right: 'rightEar' };

/** The wireframe bend is drawn larger than the measured bulge so it reads at a glance. */
const BOW_DISPLAY_GAIN = 2.5;
const BOW_DISPLAY_MIN = 0.1;
const BOW_DISPLAY_MAX = 0.25;

const ZERO: ImagePoint = { x: 0, y: 0 };
const EMPTY_REGION: BackRegionReading = { sagitta: null, confidence: 0, delta: null };

/** How long the last body yaw is kept when the world landmarks drop out. */
const YAW_HOLD_MS = 500;

/** Extra shoulder-width ratio a latched side view may drift before the camera warning flips. */
const SIDE_VIEW_HYSTERESIS = 0.08;

const VIEW_LANDMARKS: readonly PoseLandmarkName[] = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
];

/**
 * Shoulder width / torso length when both shoulders and both hips are seen.
 * Null when the far side is not seen: a profile often drops it, and that is still a side view.
 */
function shoulderToTorso(space: LandmarkSpace): number | null {
  const ls = space.pixel('leftShoulder');
  const rs = space.pixel('rightShoulder');
  const lh = space.pixel('leftHip');
  const rh = space.pixel('rightHip');
  if (!ls || !rs || !lh || !rh) return null;
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  if (torso <= 0) return null;
  return Math.hypot(ls.x - rs.x, ls.y - rs.y) / torso;
}

/**
 * Side view: the camera looks across the sagittal plane. A missing far shoulder does not
 * make this fail. `previous` keeps a reading that sits on the cutoff from flickering.
 */
function cameraSideOn(ratio: number | null, previous: boolean | null, limit: number): boolean {
  if (ratio === null) return true;
  if (previous === true) return ratio <= limit + SIDE_VIEW_HYSTERESIS;
  if (previous === false) return ratio <= limit - SIDE_VIEW_HYSTERESIS;
  return ratio <= limit;
}

function landmarkSights(pose: PoseResult, minVisibility: number): DeadliftView['landmarks'] {
  const sights: DeadliftView['landmarks'] = {};
  for (const name of VIEW_LANDMARKS) {
    const mark = pose.landmarks[POSE_LANDMARK_INDEX[name]];
    sights[name] = {
      visibility: mark?.visibility ?? 0,
      presence: typeof mark?.presence === 'number' ? mark.presence : null,
      seen: landmarkSeen(mark, minVisibility),
    };
  }
  return sights;
}

function trunkNormal(hip: Vec3, shoulder: Vec3): ImagePoint | null {
  const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (length < 1e-4) return null;
  return { x: -(shoulder.y - hip.y) / length, y: (shoulder.x - hip.x) / length };
}

/**
 * Unit direction across the trunk line toward the front of the body, in camera-plane pixels.
 * Votes from the face (nose ahead of the ear), the feet (toes ahead of the heel) and the knee
 * (ahead of the trunk in a hinge). The arms are left out: they move freely.
 */
function chestDirection(space: LandmarkSpace, side: BodySide, hip: Vec3, shoulder: Vec3): ImagePoint | null {
  const normal = trunkNormal(hip, shoulder);
  if (!normal) return null;
  const legs = SIDE_LANDMARKS[side];
  const cues: [Vec3 | null, Vec3 | null][] = [
    [space.pixel(EAR[side]), space.pixel('nose')],
    [space.pixel(legs.heel), space.pixel(legs.toe)],
    [hip, space.pixel(legs.knee)],
  ];
  let vote = 0;
  for (const [from, to] of cues) {
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    vote += (dx * normal.x + dy * normal.y) / len;
  }
  if (Math.abs(vote) < 0.3) return null;
  return vote > 0 ? normal : { x: -normal.x, y: -normal.y };
}

/** Hip → shoulder in four points, the middle two shifted by `bow` toward its peak. */
function backPoints(hip: ImagePoint, shoulder: ImagePoint, bow: ImagePoint): ImagePoint[] {
  const along = (t: number) => {
    const scale = spineBowScale(t);
    return {
      x: hip.x + (shoulder.x - hip.x) * t + bow.x * scale,
      y: hip.y + (shoulder.y - hip.y) * t + bow.y * scale,
    };
  };
  return [hip, along(1 / 3), along(2 / 3), shoulder];
}

/** Draw the warning bow when a rounding class is active. The measured outline is unchanged. */
function decideBack(frame: DeadliftFormFrame, rounded: boolean): DeadliftFormFrame {
  const hip = frame.back[0]!;
  const shoulder = frame.back[frame.back.length - 1]!;
  let spineBow = ZERO;
  const regional = Math.max(frame.thoracic.sagitta ?? 0, frame.lumbar.sagitta ?? 0);
  const bulge = Math.max(frame.backBulgeRatio ?? 0, regional);
  if (rounded && frame.backOutward && bulge > 0) {
    const shown = Math.min(BOW_DISPLAY_MAX, Math.max(BOW_DISPLAY_MIN, bulge * BOW_DISPLAY_GAIN));
    spineBow = { x: frame.backOutward.x * shown, y: frame.backOutward.y * shown };
  }
  return { ...frame, rounded, spineBow, back: backPoints(hip, shoulder, spineBow) };
}

export interface DeadliftMeasureOptions {
  frameAspect?: number;
  /** Keeps the reference axis across frames; a fresh one (screen up) is used when omitted. */
  axis?: ScreenAxisLock;
  /** Read the outline while upright, so a standing baseline can be captured. */
  includeUprightContour?: boolean;
  /** Previous side-view decision, so a ratio near the cutoff does not flicker. */
  cameraSideOn?: boolean | null;
  /** Where the chest was last seen. Lets keypoints be read on a frame where no landmark can say. */
  chestSign?: ChestSign | null;
  /**
   * The keypoints were good moments ago. If they are missing now, publish nothing rather than
   * read the outline, whose scale and baseline are different.
   */
  holdKeypoints?: boolean;
  /**
   * Smooths the body yaw read from the world landmarks this frame. Without it the raw reading is
   * used. Returning null turns the foreshortening correction off.
   */
  filterYaw?: (rawYawDeg: number | null) => number | null;
}

function reading(region: RegionCurvature | undefined): BackRegionReading {
  if (!region) return EMPTY_REGION;
  return { sagitta: region.sagitta, confidence: region.confidence, delta: null };
}

function vec(point: ImagePoint): Vec3 {
  return { x: point.x, y: point.y, z: 0 };
}

function nullableRound(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : round1(value);
}

function chainRegion(sagitta: number, chain: SpineChainReading): BackRegionReading {
  return { sagitta, confidence: chain.confidence, delta: null };
}

/**
 * One frame of a deadlift. The back's shape comes from the spine keypoints when there are good
 * ones, and otherwise from the silhouette. Trunk inclination always comes from the hip and
 * shoulder landmarks. None of these is a vertebral measurement.
 * `rounded` stays false here. The monitor sets it once the reading is calibrated and sustained.
 */
export function measureDeadliftForm(
  pose: PoseResult,
  config: DeadliftFormConfig = VISION_CONFIG.deadliftForm,
  options: DeadliftMeasureOptions = {},
): DeadliftFormFrame | null {
  const space = new LandmarkSpace(
    pose,
    options.frameAspect ?? pose.frameAspect ?? 16 / 9,
    config.minimumLandmarkVisibility,
  );
  const score = (side: BodySide) =>
    space.visibility(SIDE_LANDMARKS[side].hip) + space.visibility(SIDE_LANDMARKS[side].shoulder);
  const side: BodySide = score('left') >= score('right') ? 'left' : 'right';
  const names = SIDE_LANDMARKS[side];
  const hipPixel = space.pixel(names.hip);
  const shoulderPixel = space.pixel(names.shoulder);
  if (!hipPixel || !shoulderPixel) return null;
  const hip = space.imagePoint(names.hip)!;
  const shoulder = space.imagePoint(names.shoulder)!;
  const kneePixel = space.pixel(names.knee);
  const anklePixel = space.pixel(names.ankle);
  const gate = assessDeadliftLandmarks(pose, side, config);
  const ratio = shoulderToTorso(space);
  const facingSide = cameraSideOn(ratio, options.cameraSideOn ?? null, config.sideViewRatio);
  const view: DeadliftView = {
    shoulderToTorso: ratio,
    cameraSideOn: facingSide,
    landmarksVisible: gate.curvature,
    landmarks: landmarkSights(pose, config.minimumLandmarkVisibility),
  };

  const up = (options.axis ?? new ScreenAxisLock()).update(bodyLengthAxis(space));
  const rawYaw = bodyYawDeg(pose.worldLandmarks, up, config.sagittalCorrection);
  const yaw = options.filterYaw ? options.filterYaw(rawYaw) : rawYaw;
  const stretch = sagittalStretch(yaw, config.sagittalCorrection.maxYawDeg);
  const lean = fromVerticalDeg(hipPixel, shoulderPixel, up);
  const trunkLeanDeg = round1(lean);
  const torsoLength = Math.hypot(shoulderPixel.x - hipPixel.x, shoulderPixel.y - hipPixel.y);
  const hipAngle = kneePixel ? angleAtVertex(shoulderPixel, hipPixel, kneePixel) : Number.NaN;
  const kneeIncluded = kneePixel && anklePixel ? kneeIncludedDeg(hipPixel, kneePixel, anklePixel) : Number.NaN;

  const upright = trunkLeanDeg < config.engagedTrunkLeanDeg;
  const wantContour = !upright || options.includeUprightContour === true;
  let backCheck: DeadliftBackCheck;
  let thoracic = EMPTY_REGION;
  let lumbar = EMPTY_REGION;
  let backEdge: ImagePoint[] = [];
  let backBulgeRatio: number | null = null;
  let backBendDeg: number | null = null;
  let backOutward: ImagePoint | null = null;

  const chest = facingSide ? chestDirection(space, side, hipPixel, shoulderPixel) : null;
  const normal = trunkNormal(hipPixel, shoulderPixel);
  const chestSign: ChestSign | null = chest && normal ? (chest.x * normal.x + chest.y * normal.y > 0 ? 1 : -1) : null;
  const remembered = options.chestSign && normal ? { x: normal.x * options.chestSign, y: normal.y * options.chestSign } : null;
  const chainChest = facingSide ? (chest ?? remembered) : null;

  let chain: SpineChainReading | null = null;
  let spineRejection: SpineChainRejection | null = null;
  if (facingSide && pose.spine) {
    const result = measureSpineChain(
      pose.spine,
      { aspect: space.frameAspect, hip: hipPixel, shoulder: shoulderPixel, chest: chainChest, up, stretch },
      SPINE_CHAIN_CONFIG,
    );
    if (result.ok) chain = result.reading;
    else spineRejection = result.reason;
  }
  const holdKeypoints = options.holdKeypoints === true && !chain;

  // The curve can use the outline whenever the person is side-on, including while standing
  // and when a knee is briefly hidden. Form numbers are published only on the checks below.
  const readOutline = !chain && !holdKeypoints;
  // With keypoints in use the outline is still read, to back them up on the upper back.
  const outlineChest = chain ? chainChest : readOutline ? chest : null;
  const raw =
    facingSide && pose.silhouette && outlineChest
      ? extractBackContour(pose.silhouette, hip, shoulder, outlineChest, config)
      : null;
  if (raw && readOutline) {
    backEdge = raw.edge;
    backOutward = raw.outward;
  }
  const upperOutline = raw && chain ? reading(analyzeSpineCurvature(raw).thoracic) : null;

  // Camera angle and landmark visibility do not depend on how far the trunk has hinged.
  if (!facingSide) backCheck = 'not_side_on';
  else if (chain) {
    // The model found the spine itself, so a hidden knee does not stop the back being read.
    thoracic = chainRegion(chain.thoracic, chain);
    lumbar = chainRegion(chain.lumbar, chain);
    backBulgeRatio = chain.overall;
    backBendDeg = round1(chain.bendDeg);
    if (chainChest) {
      backOutward = {
        x: (-chainChest.x * torsoLength) / space.frameAspect,
        y: -chainChest.y * torsoLength,
      };
    }
    backCheck = upright ? 'upright' : 'judged';
  } else if (!gate.curvature) backCheck = 'landmarks_missing';
  else if (!wantContour) backCheck = 'upright';
  else if (holdKeypoints) backCheck = upright ? 'upright' : 'outline_unavailable';
  else if (!pose.silhouette) backCheck = upright ? 'upright' : 'no_silhouette';
  else if (!raw) backCheck = upright ? 'upright' : 'outline_unavailable';
  else {
    const curve = analyzeSpineCurvature(raw);
    thoracic = reading(curve.thoracic);
    lumbar = reading(curve.lumbar);
    backBulgeRatio = curve.bulgeRatio;
    backBendDeg = round1(curve.bendDeg);
    const confident =
      thoracic.confidence >= config.minContourConfidence && lumbar.confidence >= config.minContourConfidence;
    if (!confident) backCheck = upright ? 'upright' : 'outline_unavailable';
    else backCheck = upright ? 'upright' : 'judged';
  }

  const ear = space.get(EAR[side]) ? space.imagePoint(EAR[side]) : null;
  const hipHingeDeg = Number.isFinite(hipAngle) ? round1(hipAngle) : null;
  const spineCurve = chain
    ? spineCurveFromChain(chain, trunkLeanDeg, hipHingeDeg)
    : estimateSpineCurve({
        hip,
        shoulder,
        ear,
        outward: facingSide ? backOutward : null,
        contour: facingSide ? backEdge : [],
        segmentationConfidence:
          facingSide && backEdge.length > 0 ? Math.min(1, backEdge.length / Math.max(5, config.backSampleCount)) : 0,
        frameAspect: options.frameAspect ?? pose.frameAspect,
        trunkInclinationDeg: trunkLeanDeg,
        hipHingeDeg,
      });

  const frame: DeadliftFormFrame = {
    side,
    back: [hip, shoulder],
    head: ear,
    trunkLeanDeg,
    backAngleDeg: trunkLeanDeg,
    upImage: space.imageDirection(up),
    backEdge,
    backBulgeRatio,
    backBendDeg,
    backCheck,
    spineSource: chain || holdKeypoints ? 'spinepose' : 'outline',
    spineRejection,
    spineCapturedAt: chain && pose.spine ? pose.spine.capturedAt : null,
    chestSign,
    spineBendDeltaDeg: null,
    upperBackLineDeg: chain && chain.upperBackLineDeg !== null ? round1(chain.upperBackLineDeg) : null,
    upperBackLineDeltaDeg: null,
    upperBackLineBent: false,
    pelvicTiltDeg: chain && chain.pelvicTiltDeg !== null ? round1(chain.pelvicTiltDeg) : null,
    pelvicTiltDeltaDeg: null,
    trunkInclination3dDeg: nullableRound(trunkInclination3dDeg(pose.worldLandmarks, up, config.worldTorsoLengthM)),
    bodyYawDeg: nullableRound(yaw),
    sagittalStretch: stretch,
    upperOutline,
    backOutward,
    spineBow: ZERO,
    rounded: false,
    thoracic,
    lumbar,
    spineCurve,
    trunkInclinationDeg: trunkLeanDeg,
    hipAngleDeg: Number.isFinite(hipAngle) ? round1(hipAngle) : null,
    pelvicOrientationDeg: null,
    hipShoulderOffset: torsoLength > 0 ? sideComponent(hipPixel, shoulderPixel, up) / torsoLength : 0,
    kneeIncludedDeg: Number.isFinite(kneeIncluded) ? round1(kneeIncluded) : null,
    hipY: hipPixel.y,
    sideOn: facingSide,
    phase: 'setup',
    classification: 'insufficient_tracking',
    calibration: 'missing',
    landmarkConfidence: gate.confidence,
    worldLandmarksReliable: gate.worldLandmarksReliable,
    view,
    cameraHip: { x: hipPixel.x, y: hipPixel.y },
    cameraShoulder: { x: shoulderPixel.x, y: shoulderPixel.y },
    cameraKnee: kneePixel ? { x: kneePixel.x, y: kneePixel.y } : null,
    cameraAnkle: anklePixel ? { x: anklePixel.x, y: anklePixel.y } : null,
    cameraUp: { x: up.x, y: up.y },
  };
  return decideBack(frame, false);
}

function smoothFrame(frame: DeadliftFormFrame, tracker: PostureTemporalTracker, timestamp: number): DeadliftFormFrame {
  const smoothed = tracker.smooth(
    {
      thoracicSagitta: frame.thoracic.sagitta,
      lumbarSagitta: frame.lumbar.sagitta,
      trunkLeanDeg: frame.trunkLeanDeg,
      hip: frame.cameraHip,
      shoulder: frame.cameraShoulder,
      knee: frame.cameraKnee,
    },
    timestamp,
  );
  const hip = smoothed.hip ?? frame.cameraHip;
  const shoulder = smoothed.shoulder ?? frame.cameraShoulder;
  const up = frame.cameraUp;
  const lean = fromVerticalDeg(vec(hip), vec(shoulder), up);
  const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  const knee = smoothed.knee ?? frame.cameraKnee;
  const hipAngle = knee ? angleAtVertex(vec(shoulder), vec(hip), vec(knee)) : Number.NaN;
  const kneeIncluded =
    knee && frame.cameraAnkle ? kneeIncludedDeg(vec(hip), vec(knee), vec(frame.cameraAnkle)) : Number.NaN;
  const trunkLeanDeg = round1(lean);
  return {
    ...frame,
    trunkLeanDeg,
    trunkInclinationDeg: trunkLeanDeg,
    backAngleDeg: trunkLeanDeg,
    hipShoulderOffset: length > 0 ? sideComponent(vec(hip), vec(shoulder), up) / length : frame.hipShoulderOffset,
    hipAngleDeg: Number.isFinite(hipAngle) ? round1(hipAngle) : frame.hipAngleDeg,
    kneeIncludedDeg: Number.isFinite(kneeIncluded) ? round1(kneeIncluded) : frame.kneeIncludedDeg,
    hipY: hip.y,
    cameraHip: hip,
    cameraShoulder: shoulder,
    cameraKnee: knee,
    thoracic: { ...frame.thoracic, sagitta: smoothed.thoracicSagitta },
    lumbar: { ...frame.lumbar, sagitta: smoothed.lumbarSagitta },
  };
}

interface ResolvedDeadliftConfig {
  form: DeadliftFormConfig;
  calibration: ConstructorParameters<typeof NeutralSpineCalibrator>[0];
}

function resolveConfig(partial: Partial<DeadliftFormConfig> = {}): ResolvedDeadliftConfig {
  const form: DeadliftFormConfig = {
    ...VISION_CONFIG.deadliftForm,
    ...partial,
    worldTorsoLengthM: { ...VISION_CONFIG.deadliftForm.worldTorsoLengthM, ...partial.worldTorsoLengthM },
    worldThighLengthM: { ...VISION_CONFIG.deadliftForm.worldThighLengthM, ...partial.worldThighLengthM },
    oneEuro: { ...VISION_CONFIG.deadliftForm.oneEuro, ...partial.oneEuro },
    sagittalCorrection: { ...VISION_CONFIG.deadliftForm.sagittalCorrection, ...partial.sagittalCorrection },
    calibration: { ...VISION_CONFIG.deadliftForm.calibration, ...partial.calibration },
  };
  return {
    form,
    calibration: { ...form.calibration, minContourConfidence: form.minContourConfidence },
  };
}

/**
 * Deadlift form over time. Regional back estimates are smoothed, compared with the standing
 * baseline, and held for `sustainMs` before a warning. Forward lean by itself is not a warning.
 * A rep whose hinged frames were mostly unjudged is not scored correct.
 *
 * Spine keypoints are used whenever they are good. They and the outline read on different scales,
 * so each has its own baseline and thresholds, and moving between them starts the smoothing and any
 * open warning afresh.
 */
export class DeadliftFormMonitor {
  private readonly config: DeadliftFormConfig;
  private readonly timer: FaultTimer<DeadliftFaultCode>;
  private readonly axis = new ScreenAxisLock();
  private readonly tracker: PostureTemporalTracker;
  private readonly spineCurves: SpineCurveTracker;
  private readonly calibrators: Record<SpineSignalSource, NeutralSpineCalibrator>;
  private readonly bendFilter: OneEuroFilter;
  private readonly lineFilter: OneEuroFilter;
  private readonly pelvisFilter: OneEuroFilter;
  private readonly inclineFilter: OneEuroFilter;
  private readonly yawFilter: OneEuroFilter;
  private readonly upperOutline: UpperBackOutline;
  private readonly chainMedians = {
    thoracic: new RecentMedian(SPINE_CHAIN_CONFIG.medianCaptures),
    lumbar: new RecentMedian(SPINE_CHAIN_CONFIG.medianCaptures),
    bend: new RecentMedian(SPINE_CHAIN_CONFIG.medianCaptures),
    line: new RecentMedian(SPINE_CHAIN_CONFIG.medianCaptures),
    pelvis: new RecentMedian(SPINE_CHAIN_CONFIG.medianCaptures),
  };
  /** Medians of the latest model result. A repeat of that result reuses them. */
  private chainSteady: {
    thoracic: number;
    lumbar: number;
    bend: number;
    line: number | null;
    pelvis: number | null;
  } | null = null;
  /** Last smoothed body yaw, held briefly when the world landmarks drop out for a frame. */
  private lastYaw: { value: number; at: number } | null = null;
  private source: SpineSignalSource = 'outline';
  /** When the keypoints were last good, so a short dropout does not fall back to the outline. */
  private lastChainAt: number | null = null;
  /** Keypoint capture most recently counted. The model repeats a result until the next one is ready. */
  private lastCaptureAt: number | null = null;
  private chestSign: ChestSign | null = null;
  private latch: RoundingLatch = { thoracic: false, lumbar: false };
  /** Consecutive raw frames over the enter delta. One frame cannot open a warning. */
  private hot = { thoracic: 0, lumbar: 0 };
  /** Consecutive new keypoint captures with the T8–T3–C7 line over its threshold. */
  private lineHot = 0;
  /** The T8–T3–C7 line is holding the upper-back warning open. */
  private lineLatched = false;
  private phase: DeadliftPhaseState = initialDeadliftPhaseState();
  /** Last side-view decision, so the camera warning does not flicker on the cutoff. */
  private cameraSideOn: boolean | null = null;
  /** When the shoulder, hip, or knee first went missing. A short gap is not a warning. */
  private missingSince: number | null = null;
  /** Last check that was not a landmark-visibility warning. */
  private displayedCheck: DeadliftBackCheck | null = null;
  private withheldReps = 0;
  private seenRepCount = 0;
  private hingedFrames = 0;
  private judgedFrames = 0;
  private lastCorrectReps = 0;

  constructor(config: Partial<DeadliftFormConfig> = {}) {
    const resolved = resolveConfig(config);
    this.config = resolved.form;
    this.timer = new FaultTimer<DeadliftFaultCode>(DEADLIFT_FAULT_PRIORITY, this.config);
    this.tracker = new PostureTemporalTracker(this.config.oneEuro);
    this.spineCurves = new SpineCurveTracker(this.config.oneEuro);
    this.bendFilter = new OneEuroFilter(this.config.oneEuro);
    this.lineFilter = new OneEuroFilter(this.config.oneEuro);
    this.pelvisFilter = new OneEuroFilter(this.config.oneEuro);
    this.inclineFilter = new OneEuroFilter(this.config.oneEuro);
    this.yawFilter = new OneEuroFilter(this.config.oneEuro);
    this.upperOutline = new UpperBackOutline({
      minFrames: this.config.calibration.minFrames,
      minDurationMs: this.config.calibration.minDurationMs,
      minContourConfidence: this.config.minContourConfidence,
      oneEuro: this.config.oneEuro,
    });
    this.calibrators = {
      outline: new NeutralSpineCalibrator(resolved.calibration),
      spinepose: new NeutralSpineCalibrator(
        {
          ...resolved.calibration,
          minFrames: SPINE_CHAIN_CONFIG.calibrationMinCaptures,
          // The next sample may be a whole inference away, and up to this old before it stops being used.
          sampleGapMs: VISION_CONFIG.spinePose.maxResultAgeMs + 100,
        },
        'spinepose',
      ),
    };
  }

  reset(): void {
    this.timer.reset();
    this.axis.reset();
    this.tracker.reset();
    this.spineCurves.reset();
    this.bendFilter.reset();
    this.lineFilter.reset();
    this.pelvisFilter.reset();
    this.inclineFilter.reset();
    this.yawFilter.reset();
    this.lastYaw = null;
    this.upperOutline.reset();
    this.resetChainMedians();
    this.calibrators.outline.reset();
    this.calibrators.spinepose.reset();
    this.source = 'outline';
    this.lastChainAt = null;
    this.lastCaptureAt = null;
    this.chestSign = null;
    this.latch = { thoracic: false, lumbar: false };
    this.hot = { thoracic: 0, lumbar: 0 };
    this.lineHot = 0;
    this.lineLatched = false;
    this.phase = initialDeadliftPhaseState();
    this.cameraSideOn = null;
    this.missingSince = null;
    this.displayedCheck = null;
    this.withheldReps = 0;
    this.seenRepCount = 0;
    this.hingedFrames = 0;
    this.judgedFrames = 0;
    this.lastCorrectReps = 0;
  }

  update(
    pose: PoseResult | null,
    timestamp: number,
    repCount: number,
    frameAspect?: number,
  ): DeadliftFormResult {
    const measured = pose
      ? measureDeadliftForm(pose, this.config, {
          frameAspect,
          axis: this.axis,
          includeUprightContour: true,
          cameraSideOn: this.cameraSideOn,
          chestSign: this.chestSign,
          holdKeypoints: this.lastChainAt !== null && timestamp - this.lastChainAt <= SPINE_CHAIN_CONFIG.holdMs,
          filterYaw: (raw) => this.smoothYaw(raw, timestamp),
        })
      : null;
    if (!measured) return this.finish(null, [], timestamp, repCount);
    this.cameraSideOn = measured.view.cameraSideOn;
    if (measured.chestSign) this.chestSign = measured.chestSign;

    const chainRead = measured.spineCapturedAt !== null;
    if (chainRead) this.lastChainAt = timestamp;
    this.useSource(measured.spineSource);
    // The model runs slower than the camera and repeats its result until the next one. A repeat
    // is not new evidence, so it cannot fill a baseline or arm a warning.
    const newEvidence = !chainRead || measured.spineCapturedAt !== this.lastCaptureAt;
    if (chainRead) this.lastCaptureAt = measured.spineCapturedAt;

    const calibrator = this.calibrators[this.source];
    const calibration = assessNeutralSpineProfile(
      newEvidence
        ? this.observeBaseline(
            measured.spineCurve.status === 'measured'
              ? measured
              : {
                  ...measured,
                  thoracic: { ...measured.thoracic, sagitta: null },
                  lumbar: { ...measured.lumbar, sagitta: null },
                },
            timestamp,
          )
        : calibrator.current(),
      Date.now(),
      this.config.calibration.maxAgeMs,
      this.source,
    );
    const steady = chainRead ? this.steadyChain(measured, newEvidence) : measured;
    const smoothed = smoothFrame(steady, this.tracker, timestamp);
    const trackedCurve = this.spineCurves.smooth(smoothed.spineCurve, timestamp);
    smoothed.spineCurve = {
      ...trackedCurve,
      trunkInclinationDeg: smoothed.trunkLeanDeg,
      hipHingeDeg: smoothed.hipAngleDeg,
    };
    // An outline that was not measured does not keep a curvature number, so a gap cannot warn.
    const curveTrusted = measured.spineCurve.status === 'measured';
    if (!curveTrusted) {
      smoothed.thoracic = { ...smoothed.thoracic, sagitta: null };
      smoothed.lumbar = { ...smoothed.lumbar, sagitta: null };
    }
    const thresholds = this.thresholds();
    const line =
      chainRead && steady.upperBackLineDeg !== null ? this.lineFilter.filter(steady.upperBackLineDeg, timestamp) : null;
    const pelvis =
      chainRead && steady.pelvicTiltDeg !== null ? this.pelvisFilter.filter(steady.pelvicTiltDeg, timestamp) : null;
    const lineBaseline = calibration.profile?.upperBackLineDeg;
    const lineDelta = line !== null && lineBaseline !== undefined ? line - lineBaseline : null;
    if (newEvidence) {
      this.armLine(curveTrusted && chainRead ? steady.upperBackLineDeg : null, lineBaseline);
      this.arm(
        curveTrusted ? steady.thoracic.sagitta : null,
        calibration.profile?.thoracicSagitta,
        'thoracic',
        thresholds.thoracicEnterDelta,
      );
      this.arm(
        curveTrusted ? steady.lumbar.sagitta : null,
        calibration.profile?.lumbarSagitta,
        'lumbar',
        thresholds.lumbarEnterDelta,
      );
    }
    const engaged = smoothed.trunkLeanDeg >= this.config.engagedTrunkLeanDeg;
    this.lineLatched = this.decideLine(lineDelta, engaged && curveTrusted && calibration.status === 'ready');
    const outlineRise = this.upperOutline.update(
      measured.upperOutline?.sagitta ?? null,
      measured.upperOutline?.confidence ?? 0,
      measured.trunkLeanDeg <= this.config.calibration.maxTrunkLeanDeg,
      timestamp,
    );
    const judged = classifyPosture(
      {
        thoracicSagitta: this.outlineBacksUpperBack(
          outlineRise,
          smoothed.thoracic.sagitta,
          calibration.profile?.thoracicSagitta,
          thresholds.thoracicEnterDelta,
        )
          ? calibration.profile!.thoracicSagitta + thresholds.thoracicEnterDelta * 1.01
          : this.sagittaForClass('thoracic', smoothed.thoracic.sagitta, calibration.profile?.thoracicSagitta),
        lumbarSagitta: this.sagittaForClass('lumbar', smoothed.lumbar.sagitta, calibration.profile?.lumbarSagitta),
        thoracicConfidence: smoothed.thoracic.confidence,
        lumbarConfidence: smoothed.lumbar.confidence,
        baseline: calibration.profile,
        calibration: calibration.status,
        latch: this.latch,
        engaged,
        upperBackLineBent: this.lineLatched,
      },
      thresholds,
    );
    this.latch = judged.latch;
    this.phase = stepDeadliftPhase(
      this.phase,
      { trunkLeanDeg: smoothed.trunkLeanDeg, kneeIncludedDeg: smoothed.kneeIncludedDeg, hipY: smoothed.hipY },
      this.config,
    );
    const pelvic =
      calibration.profile && smoothed.hipAngleDeg !== null
        ? round1(calibration.profile.hipAngleDeg - smoothed.hipAngleDeg)
        : null;
    const bend = chainRead && steady.backBendDeg !== null ? this.bendFilter.filter(steady.backBendDeg, timestamp) : null;
    const baselineBend = calibration.profile?.bendDeg;
    const pelvisBaseline = calibration.profile?.pelvicTiltDeg;
    const incline = measured.trunkInclination3dDeg;
    if (incline === null) this.inclineFilter.reset();
    const upperRounded =
      judged.classification === 'possible_upper_back_rounding' || judged.classification === 'possible_combined_rounding';
    const frame = decideBack(
      {
        ...smoothed,
        spineBendDeltaDeg: bend !== null && baselineBend !== undefined ? round1(Math.max(0, bend - baselineBend)) : null,
        upperBackLineDeg: line !== null ? round1(line) : null,
        upperBackLineDeltaDeg: lineDelta !== null ? round1(Math.max(0, lineDelta)) : null,
        upperBackLineBent: this.lineLatched && upperRounded,
        pelvicTiltDeg: pelvis !== null ? round1(pelvis) : null,
        pelvicTiltDeltaDeg: pelvis !== null && pelvisBaseline !== undefined ? round1(pelvis - pelvisBaseline) : null,
        trunkInclination3dDeg: incline === null ? null : round1(this.inclineFilter.filter(incline, timestamp)),
        backCheck: this.reportCheck(smoothed.backCheck, timestamp),
        thoracic: {
          ...smoothed.thoracic,
          delta: this.regionDelta(smoothed.thoracic.sagitta, calibration.profile?.thoracicSagitta, judged.thoracicDelta),
        },
        lumbar: {
          ...smoothed.lumbar,
          delta: this.regionDelta(smoothed.lumbar.sagitta, calibration.profile?.lumbarSagitta, judged.lumbarDelta),
        },
        pelvicOrientationDeg: pelvic,
        phase: this.phase.phase,
        classification: judged.classification,
        calibration: calibration.status,
      },
      judged.fault !== null,
    );
    if (engaged) {
      this.hingedFrames += 1;
      if (frame.backCheck === 'judged' && frame.calibration === 'ready' && frame.classification !== 'insufficient_tracking') {
        this.judgedFrames += 1;
      }
    }
    return this.finish(frame, judged.fault ? [judged.fault] : [], timestamp, repCount);
  }

  /** Readings from the other source are on another scale, so nothing carries over. */
  private useSource(source: SpineSignalSource): void {
    if (source === this.source) return;
    this.source = source;
    this.tracker.reset();
    this.bendFilter.reset();
    this.lineFilter.reset();
    this.pelvisFilter.reset();
    this.resetChainMedians();
    this.latch = { thoracic: false, lumbar: false };
    this.hot = { thoracic: 0, lumbar: 0 };
    this.lineHot = 0;
    this.lineLatched = false;
    this.lastCaptureAt = null;
  }

  /** One Euro on the body yaw. A short dropout keeps the last value rather than flipping the correction off. */
  private smoothYaw(raw: number | null, timestamp: number): number | null {
    if (raw !== null) {
      const value = this.yawFilter.filter(raw, timestamp);
      this.lastYaw = { value, at: timestamp };
      return value;
    }
    if (this.lastYaw && timestamp - this.lastYaw.at >= 0 && timestamp - this.lastYaw.at <= YAW_HOLD_MS) {
      return this.lastYaw.value;
    }
    this.yawFilter.reset();
    this.lastYaw = null;
    return null;
  }

  /** Counts new captures with the T8–T3–C7 line over its threshold. One capture cannot open a warning. */
  private armLine(raw: number | null, baseline: number | undefined): void {
    if (raw === null || baseline === undefined) {
      this.lineHot = 0;
      return;
    }
    const enter = SPINE_CHAIN_CONFIG.upperBackLineEnterDeg;
    const delta = raw - baseline;
    if (delta > enter) this.lineHot += 1;
    else if (delta <= enter * this.config.deltaRelease) this.lineHot = 0;
  }

  /**
   * The T8–T3–C7 line counts as bent once two new captures have been over the threshold and the
   * smoothed reading is too. An open warning holds until the reading falls below the release share.
   * Keypoints only: the outline has no equivalent of these three points.
   */
  private decideLine(delta: number | null, judging: boolean): boolean {
    if (!judging || delta === null || this.source !== 'spinepose') return false;
    const enter = SPINE_CHAIN_CONFIG.upperBackLineEnterDeg;
    if (this.lineLatched) return delta > enter * this.config.deltaRelease;
    return this.lineHot >= 2 && delta > enter;
  }

  private resetChainMedians(): void {
    this.chainMedians.thoracic.reset();
    this.chainMedians.lumbar.reset();
    this.chainMedians.bend.reset();
    this.chainMedians.line.reset();
    this.chainMedians.pelvis.reset();
    this.chainSteady = null;
  }

  /** The frame with its keypoint readings replaced by their recent medians. */
  private steadyChain(frame: DeadliftFormFrame, newEvidence: boolean): DeadliftFormFrame {
    const { sagitta: thoracic } = frame.thoracic;
    const { sagitta: lumbar } = frame.lumbar;
    if (thoracic === null || lumbar === null || frame.backBendDeg === null) return frame;
    if (newEvidence || !this.chainSteady) {
      const line = frame.upperBackLineDeg;
      const pelvis = frame.pelvicTiltDeg;
      this.chainSteady = {
        thoracic: this.chainMedians.thoracic.add(thoracic),
        lumbar: this.chainMedians.lumbar.add(lumbar),
        bend: this.chainMedians.bend.add(frame.backBendDeg),
        line: line === null ? null : this.chainMedians.line.add(line),
        pelvis: pelvis === null ? null : this.chainMedians.pelvis.add(pelvis),
      };
    }
    return {
      ...frame,
      thoracic: { ...frame.thoracic, sagitta: this.chainSteady.thoracic },
      lumbar: { ...frame.lumbar, sagitta: this.chainSteady.lumbar },
      backBendDeg: this.chainSteady.bend,
      upperBackLineDeg: this.chainSteady.line,
      pelvicTiltDeg: this.chainSteady.pelvis,
    };
  }

  /**
   * The outline is past its threshold and the keypoints are at least part of the way past theirs.
   * The model flattens bends, so this catches an upper back it alone would leave just under the
   * line. The outline cannot open a warning by itself: loose clothing moves it.
   */
  private outlineBacksUpperBack(
    outlineRise: number | null,
    thoracic: number | null,
    baseline: number | undefined,
    enter: number,
  ): boolean {
    if (this.source !== 'spinepose' || outlineRise === null || thoracic === null || baseline === undefined) return false;
    const hold = this.latch.thoracic ? this.config.deltaRelease : 1;
    return (
      outlineRise > this.config.thoracicEnterDelta * hold &&
      thoracic - baseline > enter * SPINE_CHAIN_CONFIG.outlineConfirmShare * hold
    );
  }

  private thresholds(): ClassifyConfig {
    if (this.source === 'outline') return this.config;
    return {
      ...this.config,
      thoracicEnterDelta: SPINE_CHAIN_CONFIG.thoracicEnterDelta,
      lumbarEnterDelta: SPINE_CHAIN_CONFIG.lumbarEnterDelta,
    };
  }

  /**
   * A landmark that drops for less than `dropoutGraceMs` keeps the previous check.
   * Hinging does not start this timer. Only a shoulder, hip, or knee that is actually unseen does.
   */
  private reportCheck(check: DeadliftBackCheck, timestamp: number): DeadliftBackCheck {
    if (check !== 'landmarks_missing') {
      this.missingSince = null;
      this.displayedCheck = check;
      return check;
    }
    if (this.missingSince === null) this.missingSince = timestamp;
    if (timestamp - this.missingSince >= this.config.dropoutGraceMs) {
      this.displayedCheck = 'landmarks_missing';
      return 'landmarks_missing';
    }
    return this.displayedCheck ?? 'upright';
  }

  private arm(raw: number | null, baseline: number | undefined, key: 'thoracic' | 'lumbar', enter: number): void {
    if (baseline === undefined || raw === null) {
      this.hot[key] = 0;
      return;
    }
    const delta = raw - baseline;
    if (delta > enter) this.hot[key] += 1;
    else if (delta <= enter * this.config.deltaRelease) this.hot[key] = 0;
  }

  /** A new warning needs two raw frames over the line. An open warning keeps the smoothed value. */
  private sagittaForClass(key: 'thoracic' | 'lumbar', smoothed: number | null, baseline: number | undefined): number | null {
    if (baseline === undefined || this.latch[key] || this.hot[key] >= 2) return smoothed;
    return baseline;
  }

  private regionDelta(sagitta: number | null, baseline: number | undefined, fallback: number | null): number | null {
    if (baseline === undefined || sagitta === null) return fallback;
    return sagitta - baseline;
  }

  private observeBaseline(frame: DeadliftFormFrame, timestamp: number): NeutralSpineProfile | null {
    const thoracic = frame.thoracic.sagitta;
    const lumbar = frame.lumbar.sagitta;
    const calibrator = this.calibrators[this.source];
    if (thoracic === null || lumbar === null || frame.hipAngleDeg === null) {
      return calibrator.observe(null, timestamp);
    }
    const length = Math.hypot(frame.cameraShoulder.x - frame.cameraHip.x, frame.cameraShoulder.y - frame.cameraHip.y);
    return calibrator.observe(
      {
        thoracicSagitta: thoracic,
        lumbarSagitta: lumbar,
        thoracicConfidence: frame.thoracic.confidence,
        lumbarConfidence: frame.lumbar.confidence,
        trunkLeanDeg: frame.trunkLeanDeg,
        hipAngleDeg: frame.hipAngleDeg,
        hipShoulderScale: length,
        upright: frame.trunkLeanDeg <= this.config.calibration.maxTrunkLeanDeg,
        sideOn: frame.sideOn,
        bendDeg: frame.spineCapturedAt !== null ? frame.backBendDeg : null,
        upperBackLineDeg: frame.spineCapturedAt !== null ? frame.upperBackLineDeg : null,
        pelvicTiltDeg: frame.spineCapturedAt !== null ? frame.pelvicTiltDeg : null,
      },
      timestamp,
    );
  }

  private finish(
    frame: DeadliftFormFrame | null,
    faults: readonly DeadliftFaultCode[],
    timestamp: number,
    repCount: number,
  ): DeadliftFormResult {
    if (repCount < this.seenRepCount) {
      this.withheldReps = 0;
      this.hingedFrames = 0;
      this.judgedFrames = 0;
      this.seenRepCount = repCount;
    }
    const timed = this.timer.update(frame, faults, timestamp, repCount);
    if (repCount > this.seenRepCount) {
      if (timed.correctReps > this.lastCorrectReps) {
        const share = this.hingedFrames === 0 ? 0 : this.judgedFrames / this.hingedFrames;
        if (share < this.config.minJudgedCoverage) this.withheldReps += timed.correctReps - this.lastCorrectReps;
      }
      this.hingedFrames = 0;
      this.judgedFrames = 0;
      this.seenRepCount = repCount;
    }
    this.lastCorrectReps = timed.correctReps;
    if (this.withheldReps === 0) return timed;
    return { ...timed, correctReps: Math.max(0, timed.correctReps - this.withheldReps) };
  }
}
