import { VISION_CONFIG } from '../config';
import type { PoseResult, Vec3 } from '../types';
import type { LungeRangeModel, RangeView } from './angleRangeModels';
import {
  bodyLengthAxis,
  FaultTimer,
  fromVerticalDeg,
  KNEE_LINE_FAULTS,
  kneeFlexionDeg,
  kneeIncludedDeg,
  LandmarkSpace,
  lineTilt,
  midpoint,
  round1,
  ScreenAxisLock,
  sideComponent,
  signedFromVerticalDeg,
  SIDE_LANDMARKS,
  trunkMidlineTilt,
  upComponent,
  type BodyAxis,
  type BodySide,
  type FaultStatus,
  type FormResult,
  type KneeLineFaultCode,
  type Tilt,
} from './formCommon';
import { RangeRepJudge, type RangeSample, type RangeSessionState } from './rangeRepJudge';
import { detectView } from './squatForm';

export type LungeFaultCode = KneeLineFaultCode;

export const LUNGE_FAULT_PRIORITY: readonly LungeFaultCode[] = [
  'left_knee_inward',
  'right_knee_inward',
  'left_knee_outward',
  'right_knee_outward',
];

export interface LungeKneeLine {
  side: BodySide;
  /** Image-space heel point the reference line rises from (along the screen-locked up axis). */
  heel: { x: number; y: number };
  /** Lean of the heel→knee line away from the body's up axis, in degrees. */
  deviationDeg: number;
  /** Within `kneeLineMaxDeg` of the line: drawn green, otherwise red. */
  onLine: boolean;
}

/**
 * Side-view lunge angles, the squat way (see `squatForm.ts`): each from a vertical line, 0° in
 * the patient's own standing pose once the standing zero is set.
 */
export interface LungeSideAngles {
  /** Front leg: the one whose ankle is further ahead, whatever MediaPipe calls it. */
  leadSide: BodySide;
  /** +1 when the patient faces along the body's right axis (image right when upright), −1 the other way. */
  facing: 1 | -1;
  /** Front thigh (knee → hip) against a vertical line through the knee: about 90° with the thigh level. */
  knee?: number;
  /** Trunk (hip → shoulder) against a vertical line through the hip: 0° upright. */
  back?: number;
  /** Front shin (ankle → knee) against a vertical line through the ankle: 0° upright. */
  ankle?: number;
  /** The same three before zeroing, signed: positive leaning forward. */
  kneeLean?: number;
  backLean?: number;
  ankleLean?: number;
  /** Lead knee flexion, true geometry (0° straight): decides engaged and standing. */
  leadFlexion?: number;
  /** The other knee's flexion. */
  trailFlexion?: number;
  /**
   * Where the 0° back line points, as a signed lean from the up axis (`signedFromVerticalDeg`'s
   * sign): along the patient's standing back once the zero is set, straight up before.
   */
  backReference: number;
  /** Whether the angles are measured from the patient's standing pose. */
  zeroSet: boolean;
}

export interface LungeFormFrame {
  /** Face on: the knee line and body lines. Side on: the model angles in `side`. */
  view: RangeView;
  /** Side view only. */
  side?: LungeSideAngles;
  /** Front leg: the one whose knee is checked against its toe line. */
  leadSide: BodySide;
  /** Lead knee bent far enough to be in the lunge (spoken corrections only apply then). */
  engaged: boolean;
  /** Lead knee included angle between thigh and shin: 180° with the leg straight. */
  kneeAngle?: number;
  kneeLine: LungeKneeLine | null;
  /** Reference "up" in normalized image coordinates, locked to the screen edges; reference lines follow it. */
  upImage: { x: number; y: number };
  /** Shoulder line against the screen-locked horizontal. */
  shoulderTilt?: Tilt;
  /** Hip line against the screen-locked horizontal. */
  pelvisTilt?: Tilt;
  /** Body inclination: the trunk midline (hip centre → shoulder centre) against the screen-locked vertical. */
  trunkLean?: Tilt;
  faults: LungeFaultCode[];
}

export type LungeFaultStatus = FaultStatus<LungeFaultCode>;
export type LungeFormResult = FormResult<LungeFormFrame, LungeFaultCode> & {
  /** Present when a lunge model was picked: its reps, verdicts and set summary. */
  ranges?: RangeSessionState;
};

type LungeFormConfig = typeof VISION_CONFIG.lungeForm;

/**
 * Front view: the forward foot is nearer the camera, so it sits lower in the image.
 * The current lead only changes when the other foot is clearly lower.
 */
function pickLeadSide(
  space: LandmarkSpace,
  previous: BodySide | null,
  margin: number,
  up: BodyAxis,
): BodySide {
  const left = space.pixel(SIDE_LANDMARKS.left.toe);
  const right = space.pixel(SIDE_LANDMARKS.right.toe);
  const current = previous ?? 'right';
  if (!left || !right) return current;
  // How much lower (down the body axis) the other foot sits than the current lead.
  const lowerBy = current === 'left' ? upComponent(right, left, up) : upComponent(left, right, up);
  if (lowerBy > margin) return current === 'left' ? 'right' : 'left';
  return current;
}

/**
 * Measure one front-view lunge frame: the lead knee against the vertical line
 * rising from its heel (ankle when the heel isn't visible), plus shoulder and hip
 * line angles against horizontal.
 */
export function measureLungeForm(
  pose: PoseResult,
  options: {
    frameAspect?: number;
    /** Fixed lead leg (e.g. "Forward lunge (right)"); auto-detected when omitted. */
    leadSide?: BodySide | null;
    previousLeadSide?: BodySide | null;
    config?: LungeFormConfig;
    /** Keeps the reference axis across frames; a fresh one (screen up) is used when omitted. */
    axis?: ScreenAxisLock;
  } = {},
): LungeFormFrame {
  const config = options.config ?? VISION_CONFIG.lungeForm;
  const space = new LandmarkSpace(
    pose,
    options.frameAspect ?? pose.frameAspect ?? 16 / 9,
    config.minimumLandmarkVisibility,
  );
  // Staggered feet skew any line between them, so the reference is the screen-locked axis.
  const up = (options.axis ?? new ScreenAxisLock()).update(bodyLengthAxis(space));
  // Knee angle is a joint angle: metric depth sees the bend toward the camera.
  const kneeAngleOf = (side: BodySide): number | undefined => {
    const n = SIDE_LANDMARKS[side];
    const h = space.get(n.hip);
    const k = space.get(n.knee);
    const a = space.get(n.ankle);
    if (!h || !k || !a) return undefined;
    const angle = kneeIncludedDeg(h, k, a);
    return Number.isFinite(angle) ? angle : undefined;
  };

  const leadSide =
    options.leadSide ??
    pickLeadSide(space, options.previousLeadSide ?? null, config.leadFootSwitchMargin, up);
  const names = SIDE_LANDMARKS[leadSide];
  // The heel line is drawn in the camera image, so the knee is judged against it there.
  const knee = space.pixel(names.knee);
  const heelName = space.pixel(names.heel) ? names.heel : names.ankle;
  const heel = space.pixel(heelName);
  const heelImage = space.imagePoint(heelName);

  const frame: LungeFormFrame = {
    view: 'front',
    leadSide,
    engaged: false,
    kneeLine: null,
    upImage: space.imageDirection(up),
    faults: [],
  };

  const leadAngle = kneeAngleOf(leadSide);
  if (leadAngle !== undefined) {
    frame.kneeAngle = round1(leadAngle);
    frame.engaged = leadAngle < config.engagedKneeAngleDeg;
  }

  const lh = space.pixel('leftHip');
  const rh = space.pixel('rightHip');
  const ls = space.pixel('leftShoulder');
  const rs = space.pixel('rightShoulder');

  if (knee && heel && heelImage && upComponent(heel, knee, up) > 0) {
    const deviationDeg = round1(fromVerticalDeg(heel, knee, up));
    const onLine = deviationDeg <= config.kneeLineMaxDeg;
    frame.kneeLine = { side: leadSide, heel: heelImage, deviationDeg, onLine };
    if (!onLine && frame.engaged && lh && rh) {
      const hipMid = midpoint(lh, rh);
      const inward = Math.abs(sideComponent(hipMid, knee, up)) < Math.abs(sideComponent(hipMid, heel, up));
      frame.faults.push(inward ? KNEE_LINE_FAULTS[leadSide].inward : KNEE_LINE_FAULTS[leadSide].outward);
    }
  }

  if (ls && rs) frame.shoulderTilt = lineTilt(ls, rs, up);
  if (lh && rh) frame.pelvisTilt = lineTilt(lh, rh, up);
  if (ls && rs && lh && rh) frame.trunkLean = trunkMidlineTilt(ls, rs, lh, rh, up);

  return frame;
}

const SIDES: readonly BodySide[] = ['left', 'right'];
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** Which way a side-on patient faces along the body's right axis: toes ahead of heels, else nose ahead of shoulders. */
function facingOf(space: LandmarkSpace, up: BodyAxis, previous: 1 | -1 | null): 1 | -1 {
  let ahead = 0;
  for (const side of SIDES) {
    const names = SIDE_LANDMARKS[side];
    const toe = space.pixel(names.toe);
    const heel = space.pixel(names.heel) ?? space.pixel(names.ankle);
    if (toe && heel) ahead += sideComponent(heel, toe, up);
  }
  if (ahead === 0) {
    const nose = space.pixel('nose');
    const ls = space.pixel('leftShoulder');
    const rs = space.pixel('rightShoulder');
    const shoulder = ls && rs ? midpoint(ls, rs) : (ls ?? rs);
    if (nose && shoulder) ahead = sideComponent(shoulder, nose, up);
  }
  if (ahead === 0) return previous ?? 1;
  return ahead > 0 ? 1 : -1;
}

/**
 * Measure one side-view lunge frame as true geometry: the front leg (the ankle further ahead)
 * and the trunk against vertical lines, signed so leaning forward is positive. Side on, the
 * leg bends in the camera plane, so everything is measured in the camera image, as drawn.
 */
export function measureLungeSide(
  space: LandmarkSpace,
  up: BodyAxis,
  previous: { leadSide: BodySide | null; facing: 1 | -1 | null },
  config: LungeFormConfig,
): Omit<LungeSideAngles, 'knee' | 'back' | 'ankle' | 'backReference' | 'zeroSet'> {
  const facing = facingOf(space, up, previous.facing);
  const ahead = (side: BodySide): number | undefined => {
    const names = SIDE_LANDMARKS[side];
    const foot = space.pixel(names.ankle) ?? space.pixel(names.heel);
    return foot ? sideComponent(ORIGIN, foot, up) * facing : undefined;
  };
  const shinOf = (side: BodySide): number => {
    const names = SIDE_LANDMARKS[side];
    const knee = space.pixel(names.knee);
    const ankle = space.pixel(names.ankle);
    return knee && ankle ? Math.hypot(knee.x - ankle.x, knee.y - ankle.y) : 0;
  };

  const left = ahead('left');
  const right = ahead('right');
  let leadSide: BodySide = previous.leadSide ?? 'right';
  if (left !== undefined && right !== undefined) {
    const current = previous.leadSide;
    const margin = config.sideLeadSwitchRatio * Math.max(shinOf('left'), shinOf('right'));
    if (!current) leadSide = left >= right ? 'left' : 'right';
    else {
      const other: BodySide = current === 'left' ? 'right' : 'left';
      const otherAhead = (other === 'left' ? left : right) - (current === 'left' ? left : right);
      if (otherAhead > margin) leadSide = other;
    }
  } else if (left !== undefined || right !== undefined) {
    // One leg out of view: the other must be the one the camera sees.
    leadSide = left !== undefined ? 'left' : 'right';
  }

  const lead = SIDE_LANDMARKS[leadSide];
  const trail = SIDE_LANDMARKS[leadSide === 'left' ? 'right' : 'left'];
  // Side on the two hips and shoulders are one point in the image; either stands in for the other.
  const hip = space.pixel(lead.hip) ?? space.pixel(trail.hip);
  const shoulder = space.pixel(lead.shoulder) ?? space.pixel(trail.shoulder);
  const knee = space.pixel(lead.knee);
  const ankle = space.pixel(lead.ankle);
  const trailKnee = space.pixel(trail.knee);
  const trailAnkle = space.pixel(trail.ankle);

  const reading: Omit<LungeSideAngles, 'knee' | 'back' | 'ankle' | 'backReference' | 'zeroSet'> = { leadSide, facing };
  // The thigh tips forward when the hip sits behind the knee, against facing.
  if (hip && knee) reading.kneeLean = round1(signedFromVerticalDeg(knee, hip, up) * -facing);
  if (hip && shoulder) reading.backLean = round1(signedFromVerticalDeg(hip, shoulder, up) * facing);
  if (ankle && knee) reading.ankleLean = round1(signedFromVerticalDeg(ankle, knee, up) * facing);
  if (hip && knee && ankle) {
    const flexion = kneeFlexionDeg(hip, knee, ankle);
    if (Number.isFinite(flexion)) reading.leadFlexion = round1(flexion);
  }
  if (hip && trailKnee && trailAnkle) {
    const flexion = kneeFlexionDeg(hip, trailKnee, trailAnkle);
    if (Number.isFinite(flexion)) reading.trailFlexion = round1(flexion);
  }
  return reading;
}

type LungeZeroConfig = Pick<
  LungeFormConfig,
  'zeroHoldMs' | 'zeroStillnessDeg' | 'zeroMaxGapMs' | 'zeroMaxKneeFlexionDeg' | 'zeroMaxLeanDeg' | 'zeroDeadbandDeg'
>;

type LeanName = 'kneeLean' | 'backLean' | 'ankleLean';
const LEANS: readonly LeanName[] = ['kneeLean', 'backLean', 'ankleLean'];
/** Fewest frames that can make a hold, however slow the camera. */
const MIN_HOLD_FRAMES = 5;
/** Share of a hold's readings that must sit close to the middle one. */
const STILL_SHARE = 0.9;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Side-view lunge standing zero, as for the squat: the pose held still for a second while standing
 * reads 0°. Every still standing hold refreshes it; a lunge never passes as standing, since both
 * knees must be nearly straight. Only the displayed numbers (and the back line) follow it.
 */
export class LungeSideZero {
  private zero: Partial<Record<LeanName, number>> | null = null;
  private hold: Array<{ t: number; reading: Partial<Record<LeanName, number>> }> = [];

  constructor(private readonly config: LungeZeroConfig) {}

  reset(): void {
    this.zero = null;
    this.hold = [];
  }

  apply(
    reading: Omit<LungeSideAngles, 'knee' | 'back' | 'ankle' | 'backReference' | 'zeroSet'>,
    timestamp: number,
  ): LungeSideAngles {
    this.observe(reading, timestamp);
    const zero = this.zero;
    const quiet = (deg: number) => (Math.abs(deg) <= this.config.zeroDeadbandDeg ? 0 : round1(deg));
    const measured = (name: LeanName): number | undefined => {
      const lean = reading[name];
      if (lean === undefined) return undefined;
      return zero ? quiet(Math.abs(lean - (zero[name] ?? 0))) : round1(Math.abs(lean));
    };
    const angles: LungeSideAngles = {
      ...reading,
      backReference: zero ? round1((zero.backLean ?? 0) * reading.facing) : 0,
      zeroSet: zero !== null,
    };
    const knee = measured('kneeLean');
    const back = measured('backLean');
    const ankle = measured('ankleLean');
    if (knee !== undefined) angles.knee = knee;
    if (back !== undefined) angles.back = back;
    if (ankle !== undefined) angles.ankle = ankle;
    return angles;
  }

  private looksLikeStanding(reading: Omit<LungeSideAngles, 'knee' | 'back' | 'ankle' | 'backReference' | 'zeroSet'>): boolean {
    if (reading.leadFlexion === undefined || reading.leadFlexion > this.config.zeroMaxKneeFlexionDeg) return false;
    if (reading.trailFlexion !== undefined && reading.trailFlexion > this.config.zeroMaxKneeFlexionDeg) return false;
    return LEANS.every((name) => {
      const lean = reading[name];
      return lean === undefined || Math.abs(lean) <= this.config.zeroMaxLeanDeg;
    });
  }

  private observe(
    reading: Omit<LungeSideAngles, 'knee' | 'back' | 'ankle' | 'backReference' | 'zeroSet'>,
    t: number,
  ): void {
    const previous = this.hold[this.hold.length - 1];
    if (previous && (t < previous.t || t - previous.t > this.config.zeroMaxGapMs)) this.hold = [];
    if (!this.looksLikeStanding(reading)) {
      this.hold = [];
      return;
    }
    const values: Partial<Record<LeanName, number>> = {};
    for (const name of LEANS) {
      const lean = reading[name];
      if (lean !== undefined) values[name] = lean;
    }
    this.hold.push({ t, reading: values });
    while (this.hold.length > 1 && t - this.hold[1]!.t >= this.config.zeroHoldMs) this.hold.shift();
    if (t - this.hold[0]!.t < this.config.zeroHoldMs || this.hold.length < MIN_HOLD_FRAMES) return;

    const still: Partial<Record<LeanName, number>> = {};
    for (const name of LEANS) {
      const seen = this.hold.map((sample) => sample.reading[name]).filter((v): v is number => v !== undefined);
      if (seen.length < this.hold.length / 2) continue;
      const middle = median(seen);
      const close = seen.filter((v) => Math.abs(v - middle) <= this.config.zeroStillnessDeg);
      if (close.length < seen.length * STILL_SHARE) return;
      still[name] = middle;
    }
    this.zero = { ...(this.zero ?? {}), ...still };
    this.hold = [];
  }
}

/** The readings a lunge model judges: side on, the front leg's thigh and shin and the trunk. */
export function lungeRangeSample(frame: LungeFormFrame): RangeSample {
  const side = frame.side;
  if (frame.view !== 'side' || !side) return { view: frame.view };
  return {
    view: 'side',
    ...(side.knee !== undefined ? { knee: side.knee } : {}),
    ...(side.back !== undefined ? { back: side.back } : {}),
    ...(side.ankle !== undefined ? { ankle: side.ankle } : {}),
  };
}

/**
 * Lunge form over time: held knee-line faults and correct/incorrect rep scoring. With a model
 * picked the lunge is judged side on instead: the front knee, back and ankle against its ranges.
 */
export class LungeFormMonitor {
  private readonly config: LungeFormConfig;
  private readonly timer: FaultTimer<LungeFaultCode>;
  private leadSide: BodySide | null = null;
  private readonly axis = new ScreenAxisLock();
  private view: RangeView | null = null;
  private side: { leadSide: BodySide | null; facing: 1 | -1 | null } = { leadSide: null, facing: null };
  private readonly zero: LungeSideZero;
  private readonly judge: RangeRepJudge | null;

  constructor(
    private readonly fixedLeadSide: BodySide | null = null,
    config: Partial<LungeFormConfig> = {},
    model: LungeRangeModel | null = null,
  ) {
    this.config = { ...VISION_CONFIG.lungeForm, ...config };
    this.timer = new FaultTimer(LUNGE_FAULT_PRIORITY, this.config);
    this.zero = new LungeSideZero(this.config);
    this.judge = model ? new RangeRepJudge(model) : null;
  }

  reset(): void {
    this.startNewSet();
    this.zero.reset();
    this.judge?.reset();
  }

  /** The next set: rep scores start over, the patient's standing zero carries on. */
  startNewSet(): void {
    this.timer.reset();
    this.leadSide = null;
    this.axis.reset();
    this.view = null;
    this.side = { leadSide: null, facing: null };
    this.judge?.startNewSet();
  }

  setRequiredView(view: RangeView | null): void {
    this.judge?.setRequiredView(view);
  }

  update(pose: PoseResult | null, timestamp: number, repCount: number, frameAspect?: number): LungeFormResult {
    if (!this.judge) {
      const frame = pose
        ? measureLungeForm(pose, {
            frameAspect,
            leadSide: this.fixedLeadSide,
            previousLeadSide: this.leadSide,
            config: this.config,
            axis: this.axis,
          })
        : null;
      if (frame) this.leadSide = frame.leadSide;
      return this.timer.update(frame, frame?.faults ?? [], timestamp, repCount);
    }
    const frame = this.measureModel(pose, timestamp, frameAspect);
    // The model's ranges judge the lunge; the fixed knee-line rule would contradict them.
    const result = this.timer.update(frame, [], timestamp, repCount);
    const ranges = this.judge.update(frame ? lungeRangeSample(frame) : null, timestamp);
    return { ...result, correctReps: ranges.summary.counted, incorrectReps: ranges.summary.incorrect, ranges };
  }

  /** With a model picked: frames while nothing is scored set the standing zero and show the view. */
  observeStanding(pose: PoseResult | null, timestamp: number, frameAspect?: number): LungeFormResult | null {
    if (!this.judge) return null;
    const frame = this.measureModel(pose, timestamp, frameAspect);
    const ranges = this.judge.observe(frame ? lungeRangeSample(frame) : null, timestamp);
    return { frame, faults: [], correctReps: ranges.summary.counted, incorrectReps: ranges.summary.incorrect, ranges };
  }

  private measureModel(pose: PoseResult | null, timestamp: number, frameAspect?: number): LungeFormFrame | null {
    if (!pose) return null;
    const aspect = frameAspect ?? pose.frameAspect ?? 16 / 9;
    const space = new LandmarkSpace(pose, aspect, this.config.minimumLandmarkVisibility);
    const view = detectView(space, this.view, this.config);
    if (!view) return null;
    this.view = view;
    if (view === 'front') {
      const frame = measureLungeForm(pose, {
        frameAspect: aspect,
        leadSide: this.fixedLeadSide,
        previousLeadSide: this.leadSide,
        config: this.config,
        axis: this.axis,
      });
      this.leadSide = frame.leadSide;
      return { ...frame, faults: [] };
    }
    const up = this.axis.update(bodyLengthAxis(space));
    const reading = measureLungeSide(space, up, this.side, this.config);
    this.side = { leadSide: reading.leadSide, facing: reading.facing };
    const angles = this.zero.apply(reading, timestamp);
    return {
      view: 'side',
      side: angles,
      leadSide: angles.leadSide,
      engaged: (angles.leadFlexion ?? 0) > this.config.sideEngagedKneeFlexionDeg,
      kneeLine: null,
      upImage: space.imageDirection(up),
      faults: [],
    };
  }
}
