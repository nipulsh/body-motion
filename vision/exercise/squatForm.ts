import { VISION_CONFIG } from '../config';
import { distance3D } from '../math/angles';
import type { PoseResult } from '../types';
import {
  bodyLengthAxis,
  FaultTimer,
  flat,
  fromVertical3dDeg,
  fromVerticalDeg,
  KNEE_LINE_FAULTS,
  kneeFlexionDeg,
  LandmarkSpace,
  lineTilt,
  midpoint,
  round1,
  ScreenAxisLock,
  sideComponent,
  SIDE_LANDMARKS,
  signedFromVerticalDeg,
  trunkMidlineTilt,
  upComponent,
  type BodySide,
  type FaultStatus,
  type FormResult,
  type KneeLineFaultCode,
  type Tilt,
} from './formCommon';
import type { RangeView, SquatRangeModel } from './angleRangeModels';
import { RangeRepJudge, type RangeSample, type RangeSessionState } from './rangeRepJudge';
import { SquatStandingZero } from './squatStandingZero';

export type SquatView = 'front' | 'side';

export type SquatFaultCode =
  | KneeLineFaultCode
  | 'knee_past_toes'
  | 'shoulders_uneven'
  | 'hips_uneven'
  | 'trunk_leaning_sideways'
  | 'chest_dropping';

/** Most important first: when several faults are sustained, this order picks the one to correct. */
export const SQUAT_FAULT_PRIORITY: readonly SquatFaultCode[] = [
  'left_knee_inward',
  'right_knee_inward',
  'left_knee_outward',
  'right_knee_outward',
  'knee_past_toes',
  'chest_dropping',
  'trunk_leaning_sideways',
  'hips_uneven',
  'shoulders_uneven',
];

export interface KneeLineReading {
  side: BodySide;
  /** Image-space heel point the vertical reference line rises from; null when the heel is not seen. */
  heel: { x: number; y: number } | null;
  /**
   * As a fraction of shin length. Front view: knee distance from the heel line. Side view: how far
   * the knee is past the toes, negative behind them. Null when that reference is not seen.
   */
  offsetRatio: number | null;
  /** Fault raised by this knee this frame, if any. */
  fault: SquatFaultCode | null;
}

export interface SquatFormFrame {
  view: SquatView;
  /** Knees are bent far enough to be in the squat (knee-line checks only apply then). */
  engaged: boolean;
  /**
   * How far the knee is bent, read off a vertical line through the knee: the femur (knee→hip)
   * against that line. 0° standing, about 90° with the thigh level.
   */
  kneeAngle: Partial<Record<BodySide, number>>;
  /**
   * `kneeAngle` before zeroing. Side on it is signed, so the standing zero can tell forward from
   * back; face on it is the unsigned angle, depth included.
   */
  kneeLean: Partial<Record<BodySide, number>>;
  /**
   * True flexion between femur and tibia, never drawn and never zeroed. It decides whether the
   * patient is in the squat or standing.
   */
  kneeFlexion: Partial<Record<BodySide, number>>;
  /** Side view: how far the back (hip→shoulder) bends from the vertical line through the hip: 0° upright. */
  backAngle: Partial<Record<BodySide, number>>;
  /** Knee away from the vertical line rising from its heel: how far the knee is off that line. */
  kneeHeelAngle: Partial<Record<BodySide, number>>;
  /** Side view: shin (ankle→knee) lean from vertical. Not drawn: the chest-dropping check compares it to the back. */
  ankleAngle: Partial<Record<BodySide, number>>;
  /** `backAngle` before zeroing, signed so the standing zero can tell forward from back. */
  backLean: Partial<Record<BodySide, number>>;
  /** `kneeHeelAngle` before zeroing, signed so the standing zero can tell one side from the other. */
  kneeHeelLean: Partial<Record<BodySide, number>>;
  /**
   * Front view: the tibia (heel → knee) against the vertical line at the heel, as true geometry
   * (never zeroed): positive with the knee outside that line, negative inside it (toward valgus).
   * The squat models judge it against the range for the foot's toe-out.
   */
  tibiaAngle: Partial<Record<BodySide, number>>;
  /**
   * Front view: how far each foot points out, estimated from how far the toe sits to the side of
   * the heel against a foot length taken from the shin (`toeOutFootToShinRatio`). Approximate: a
   * front camera cannot see the foot's direction itself. Negative points in.
   */
  toeOut: Partial<Record<BodySide, number>>;
  /**
   * Hip height above the knee along the reference up axis, as a share of shin length, in the
   * camera image: about 1 standing, falling toward 0 as the thigh levels. Never drawn or zeroed.
   * It tells a held squat from standing in both views without metric depth.
   */
  hipRise: Partial<Record<BodySide, number>>;
  /**
   * Side view: where the 0° back line points, as a signed lean from `upImage` (same sign as
   * `backLean`). Straight up (0, or missing) until the standing zero is set; then along the
   * patient's own standing back, so the line drawn and the number shown agree.
   */
  backReference: Partial<Record<BodySide, number>>;
  /**
   * Whether the angles are measured from this patient's standing pose (see `SquatStandingZero`).
   * Until then they are true geometry, which reads a few degrees while standing.
   */
  zeroSet: boolean;
  kneeLines: KneeLineReading[];
  /**
   * Reference "up" in normalized image coordinates, locked to the screen edges (see
   * `ScreenAxisLock`): screen up while standing, a quarter turn once the body lies down.
   * Every tilt and lean is measured against it and overlays draw their reference lines along it.
   */
  upImage: { x: number; y: number };
  /** Front view: eye line against the body's horizontal (head tilt). */
  eyeTilt?: Tilt;
  shoulderTilt?: Tilt;
  pelvisTilt?: Tilt;
  trunkSideLean?: Tilt;
  faults: SquatFaultCode[];
}

export type SquatFaultStatus = FaultStatus<SquatFaultCode>;
export type SquatFormResult = FormResult<SquatFormFrame, SquatFaultCode> & {
  /** Present when a squat model was picked: its reps, verdicts and set summary. */
  ranges?: RangeSessionState;
};

/** The readings a squat model judges. Side on, the near leg's thigh and back; face on, each tibia. */
export function squatRangeSample(frame: SquatFormFrame): RangeSample {
  if (frame.view === 'side') {
    const side = SIDES.find((s) => frame.kneeAngle[s] !== undefined) ?? SIDES.find((s) => frame.backAngle[s] !== undefined);
    return {
      view: 'side',
      ...(side && frame.kneeAngle[side] !== undefined ? { knee: frame.kneeAngle[side] } : {}),
      ...(side && frame.backAngle[side] !== undefined ? { back: frame.backAngle[side] } : {}),
    };
  }
  const rises = SIDES.map((side) => frame.hipRise[side]).filter((rise): rise is number => rise !== undefined);
  return {
    view: 'front',
    ...(rises.length > 0 ? { hipRise: rises.reduce((sum, rise) => sum + rise, 0) / rises.length } : {}),
    tibia: frame.tibiaAngle,
    toeOut: frame.toeOut,
  };
}

type SquatFormConfig = typeof VISION_CONFIG.squatForm;

const SIDES: readonly BodySide[] = ['left', 'right'];

/**
 * Side on or face on, from shoulder width against torso length. Between the two ratios the last
 * view holds, so the view does not flicker. The lunge uses it too.
 */
export function detectView(
  space: LandmarkSpace,
  previous: SquatView | null,
  config: Pick<SquatFormConfig, 'sideViewRatio' | 'frontViewRatio'>,
): SquatView | null {
  const ls = space.get('leftShoulder');
  const rs = space.get('rightShoulder');
  const lh = space.get('leftHip');
  const rh = space.get('rightHip');
  if (!ls || !rs || !lh || !rh) return previous;
  // Torso length in the camera plane: depth is the noisiest axis, and a front-on squat
  // leaning toward the camera must not stretch the torso and read as side-on. Shoulder width
  // is also measured in the camera plane so a rolled camera does not change the ratio.
  const torso = distance3D(flat(midpoint(ls, rs)), flat(midpoint(lh, rh)));
  if (torso <= 0) return previous;
  const ratio = distance3D(flat(ls), flat(rs)) / torso;
  if (ratio <= config.sideViewRatio) return 'side';
  if (ratio >= config.frontViewRatio) return 'front';
  return previous ?? (ratio < (config.sideViewRatio + config.frontViewRatio) / 2 ? 'side' : 'front');
}

/** The leg nearer the camera in a side view: the one MediaPipe sees best. */
function nearSide(space: LandmarkSpace): BodySide {
  const score = (side: BodySide) => {
    const names = SIDE_LANDMARKS[side];
    return space.visibility(names.knee) + space.visibility(names.ankle) + space.visibility(names.toe);
  };
  return score('left') >= score('right') ? 'left' : 'right';
}

/**
 * Measure one frame of a squat as true geometry: joint angles, each knee against the vertical
 * line rising from its heel, and trunk/shoulder/pelvis alignment. Faults are per-frame;
 * `SquatFormMonitor` decides when they have lasted long enough to correct, and measures the
 * displayed angles from the patient's standing pose.
 */
export function measureSquatForm(
  pose: PoseResult,
  options: {
    frameAspect?: number;
    previousView?: SquatView | null;
    config?: SquatFormConfig;
    /** Keeps the reference axis across frames; a fresh one (screen up) is used when omitted. */
    axis?: ScreenAxisLock;
  } = {},
): SquatFormFrame | null {
  const config = options.config ?? VISION_CONFIG.squatForm;
  const space = new LandmarkSpace(
    pose,
    options.frameAspect ?? pose.frameAspect ?? 16 / 9,
    config.minimumLandmarkVisibility,
  );
  const view = detectView(space, options.previousView ?? null, config);
  if (!view) return null;

  const sides = view === 'front' ? SIDES : [nearSide(space)];
  const axis = options.axis ?? new ScreenAxisLock();
  const up = axis.update(bodyLengthAxis(space));
  const kneeAngle: SquatFormFrame['kneeAngle'] = {};
  const kneeLean: SquatFormFrame['kneeLean'] = {};
  const kneeFlexion: SquatFormFrame['kneeFlexion'] = {};
  const backAngle: SquatFormFrame['backAngle'] = {};
  const ankleAngle: SquatFormFrame['ankleAngle'] = {};
  const backLean: SquatFormFrame['backLean'] = {};
  const kneeHeelAngle: SquatFormFrame['kneeHeelAngle'] = {};
  const kneeHeelLean: SquatFormFrame['kneeHeelLean'] = {};
  const hipRise: SquatFormFrame['hipRise'] = {};

  for (const side of sides) {
    const names = SIDE_LANDMARKS[side];
    if (view === 'side') {
      // Side on, the leg bends in the camera plane: measure every angle in the image, as the
      // camera sees it, so each number matches the guide drawn over the video.
      const shoulder = space.pixel(names.shoulder);
      const hip = space.pixel(names.hip);
      const knee = space.pixel(names.knee);
      const ankle = space.pixel(names.ankle);
      if (hip && knee && ankle) {
        const angle = kneeFlexionDeg(hip, knee, ankle);
        if (Number.isFinite(angle)) kneeFlexion[side] = round1(angle);
      }
      if (hip && knee) {
        kneeLean[side] = round1(signedFromVerticalDeg(knee, hip, up));
        kneeAngle[side] = round1(fromVerticalDeg(knee, hip, up));
      }
      if (shoulder && hip) {
        backLean[side] = round1(signedFromVerticalDeg(hip, shoulder, up));
        backAngle[side] = round1(fromVerticalDeg(hip, shoulder, up));
      }
      if (knee && ankle) ankleAngle[side] = round1(fromVerticalDeg(ankle, knee, up));
    } else {
      // Face on, the knee bends toward the camera, which only metric depth sees.
      const hip = space.get(names.hip);
      const knee = space.get(names.knee);
      const ankle = space.get(names.ankle);
      if (hip && knee && ankle) {
        const angle = kneeFlexionDeg(hip, knee, ankle);
        if (Number.isFinite(angle)) kneeFlexion[side] = round1(angle);
      }
      if (hip && knee) {
        const lean = round1(fromVertical3dDeg(knee, hip, up));
        kneeLean[side] = lean;
        kneeAngle[side] = lean;
      }
    }
    // The heel line is drawn in the camera image, so the knee is measured against it there.
    const knee = space.pixel(names.knee);
    const heel = space.pixel(names.heel);
    if (knee && heel) {
      kneeHeelLean[side] = round1(signedFromVerticalDeg(heel, knee, up));
      kneeHeelAngle[side] = round1(fromVerticalDeg(heel, knee, up));
    }
    // Hip height over the knee, per shin length. Both views see it in the image: side on the thigh
    // tips toward level, face on it foreshortens, and either way the hip comes down to the knee.
    const hipPx = space.pixel(names.hip);
    const anklePx = space.pixel(names.ankle);
    if (hipPx && knee && anklePx) {
      const shin = distance3D(knee, anklePx);
      if (shin > 0) hipRise[side] = Math.round((upComponent(knee, hipPx, up) / shin) * 100) / 100;
    }
  }

  const bentKnees = Object.values(kneeFlexion);
  const engaged = bentKnees.length > 0 && Math.max(...bentKnees) > config.engagedKneeFlexionDeg;
  const faults: SquatFaultCode[] = [];
  const kneeLines: KneeLineReading[] = [];

  // Alignment is judged in the camera image, the same space the heel lines and body lines are drawn in.
  const ls = space.pixel('leftShoulder');
  const rs = space.pixel('rightShoulder');
  const lh = space.pixel('leftHip');
  const rh = space.pixel('rightHip');
  const hipMid = lh && rh ? midpoint(lh, rh) : null;

  const tibiaAngle: SquatFormFrame['tibiaAngle'] = {};
  const toeOut: SquatFormFrame['toeOut'] = {};
  if (view === 'front' && hipMid) {
    for (const side of sides) {
      const names = SIDE_LANDMARKS[side];
      const knee = space.pixel(names.knee);
      const ankle = space.pixel(names.ankle);
      const heel = space.pixel(names.heel) ?? ankle;
      const toe = space.pixel(names.toe);
      if (!heel) continue;
      // Outward is away from the body's midline, whichever way the camera shows the patient.
      const outward = Math.sign(sideComponent(hipMid, heel, up)) || (side === 'left' ? 1 : -1);
      if (knee) tibiaAngle[side] = round1(signedFromVerticalDeg(heel, knee, up) * outward);
      if (toe && knee && ankle) {
        const footLength = distance3D(knee, ankle) * config.toeOutFootToShinRatio;
        if (footLength > 0) {
          const across = (sideComponent(heel, toe, up) * outward) / footLength;
          toeOut[side] = round1((Math.asin(Math.min(1, Math.max(-1, across))) * 180) / Math.PI);
        }
      }
    }
  }

  for (const side of sides) {
    const names = SIDE_LANDMARKS[side];
    const knee = space.pixel(names.knee);
    const ankle = space.pixel(names.ankle);
    const heel = space.pixel(names.heel);
    const toe = space.pixel(names.toe);
    if (!knee || !ankle) continue;
    const shin = distance3D(knee, ankle);
    if (shin <= 0) continue;

    let offsetRatio: number | null = null;
    let fault: SquatFaultCode | null = null;
    if (view === 'front') {
      if (heel) {
        offsetRatio = Math.abs(sideComponent(heel, knee, up)) / shin;
        if (engaged && hipMid && offsetRatio > config.kneeLineToleranceRatio) {
          const inward = Math.abs(sideComponent(hipMid, knee, up)) < Math.abs(sideComponent(hipMid, heel, up));
          fault = inward ? KNEE_LINE_FAULTS[side].inward : KNEE_LINE_FAULTS[side].outward;
        }
      }
    } else if (toe) {
      // A knee always travels ahead of the heel in a squat, so this one stays on the real toe.
      const forward = Math.sign(sideComponent(heel ?? ankle, toe, up)) || 1;
      offsetRatio = (sideComponent(toe, knee, up) * forward) / shin;
      if (engaged && offsetRatio > config.kneePastToeRatio) fault = 'knee_past_toes';
    }
    if (!heel && offsetRatio === null) continue;
    if (fault) faults.push(fault);
    kneeLines.push({
      side,
      heel: heel ? space.imagePoint(names.heel) : null,
      offsetRatio: offsetRatio === null ? null : round1(offsetRatio * 100) / 100,
      fault,
    });
  }

  const frame: SquatFormFrame = {
    view,
    engaged,
    upImage: space.imageDirection(up),
    kneeAngle,
    kneeLean,
    kneeFlexion,
    backAngle,
    kneeHeelAngle,
    ankleAngle,
    backLean,
    kneeHeelLean,
    tibiaAngle,
    toeOut,
    hipRise,
    backReference: {},
    zeroSet: false,
    kneeLines,
    faults,
  };

  if (view === 'front') {
    const le = space.pixel('leftEye');
    const re = space.pixel('rightEye');
    if (le && re) frame.eyeTilt = lineTilt(le, re, up);
    if (ls && rs) {
      frame.shoulderTilt = lineTilt(ls, rs, up);
      if (frame.shoulderTilt.deg > config.shoulderTiltMaxDeg) faults.push('shoulders_uneven');
    }
    if (lh && rh) {
      frame.pelvisTilt = lineTilt(lh, rh, up);
      if (frame.pelvisTilt.deg > config.pelvisTiltMaxDeg) faults.push('hips_uneven');
    }
    if (ls && rs && lh && rh) {
      frame.trunkSideLean = trunkMidlineTilt(ls, rs, lh, rh, up);
      if (frame.trunkSideLean.deg > config.trunkSideLeanMaxDeg) faults.push('trunk_leaning_sideways');
    }
  } else {
    const side = sides[0]!;
    const back = backAngle[side];
    const shinLean = ankleAngle[side];
    if (engaged && back !== undefined && shinLean !== undefined && back - shinLean > config.trunkShinGapMaxDeg) {
      faults.push('chest_dropping');
    }
  }

  return frame;
}

/** Squat form over time: held faults and correct/incorrect rep scoring. */
export class SquatFormMonitor {
  private readonly config: SquatFormConfig;
  private readonly timer: FaultTimer<SquatFaultCode>;
  private view: SquatView | null = null;
  private readonly axis = new ScreenAxisLock();
  private readonly zero: SquatStandingZero;
  /** With a model picked: grades each rep against its ranges. */
  private readonly judge: RangeRepJudge | null;

  constructor(config: Partial<SquatFormConfig> = {}, model: SquatRangeModel | null = null) {
    this.config = { ...VISION_CONFIG.squatForm, ...config };
    this.timer = new FaultTimer(SQUAT_FAULT_PRIORITY, this.config);
    this.zero = new SquatStandingZero(this.config);
    this.judge = model ? new RangeRepJudge(model) : null;
  }

  reset(): void {
    this.startNewSet();
    this.zero.reset();
    this.judge?.reset();
  }

  /** The next set: rep scores and fault timers start over, the patient's standing zero carries on. */
  startNewSet(): void {
    this.timer.reset();
    this.view = null;
    this.axis.reset();
    this.judge?.startNewSet();
  }

  /** The view this set's reps are judged in (side: knee and back; front: tibia). Null takes either. */
  setRequiredView(view: RangeView | null): void {
    this.judge?.setRequiredView(view);
  }

  update(pose: PoseResult | null, timestamp: number, repCount: number, frameAspect?: number): SquatFormResult {
    const frame = this.measure(pose, timestamp, frameAspect);
    if (!this.judge) return this.timer.update(frame, frame?.faults ?? [], timestamp, repCount);
    // With a model only its angles are monitored: no fixed-rule fault is raised beside them.
    const result = this.timer.update(frame, [], timestamp, repCount);
    const ranges = this.judge.update(frame ? squatRangeSample(frame) : null, timestamp);
    // The model's verdicts replace the fault-based rep scores.
    return { ...result, correctReps: ranges.summary.counted, incorrectReps: ranges.summary.incorrect, ranges };
  }

  /**
   * Watch for the standing pose while nothing is scored, as in the countdown before a set. With a
   * model picked it also returns the frame, so the app can see which way the patient faces.
   */
  observeStanding(pose: PoseResult | null, timestamp: number, frameAspect?: number): SquatFormResult | null {
    const frame = this.measure(pose, timestamp, frameAspect);
    if (!this.judge) return null;
    const ranges = this.judge.observe(frame ? squatRangeSample(frame) : null, timestamp);
    return { frame, faults: [], correctReps: ranges.summary.counted, incorrectReps: ranges.summary.incorrect, ranges };
  }

  private measure(pose: PoseResult | null, timestamp: number, frameAspect?: number): SquatFormFrame | null {
    if (!pose) return null;
    const frame = measureSquatForm(pose, {
      frameAspect,
      previousView: this.view,
      config: this.config,
      axis: this.axis,
    });
    if (!frame) return null;
    this.view = frame.view;
    return this.zero.apply(frame, timestamp);
  }
}
