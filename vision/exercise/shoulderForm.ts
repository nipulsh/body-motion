import { VISION_CONFIG } from '../config';
import { calculateJointAngles } from '../pose/jointAngles';
import type { PoseResult } from '../types';
import {
  bodyLengthAxis,
  LandmarkSpace,
  round1,
  ScreenAxisLock,
  type BodySide,
  type FormResult,
} from './formCommon';

export interface ShoulderFormFrame {
  /**
   * How far each arm has risen from its resting position: 0° with the arm down, growing as the
   * hand goes up. Until the resting position is known this is the raw reading.
   */
  armAngle: Partial<Record<BodySide, number>>;
  /** Whether both arms seen this frame are measured from their resting position. */
  zeroSet: boolean;
  /** Reference "up" in normalized image coordinates, locked to the screen edges. */
  upImage: { x: number; y: number };
}

/** Shoulder raises only report angles here: they have no held faults and do not score reps. */
export type ShoulderFormResult = FormResult<ShoulderFormFrame, never>;

type ShoulderFormConfig = typeof VISION_CONFIG.shoulderForm;

const SIDES: readonly BodySide[] = ['left', 'right'];
const JOINTS = { left: 'left_shoulder', right: 'right_shoulder' } as const;

/** Fewest frames that can make a hold, however slow the camera. */
const MIN_HOLD_FRAMES = 5;
/** Share of a hold's frames that must be close to the middle reading. */
const STILL_SHARE = 0.9;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * One arm's resting angle. An arm hanging at the side still reads 15–25° between hip, shoulder and
 * elbow, so the pose held still there is what reads 0°. A later, lower hold replaces it and a
 * higher one never does, so pausing with the arm partly raised cannot become the new rest.
 */
class ArmRestZero {
  private hold: Array<{ t: number; deg: number }> = [];
  private zero: number | null = null;

  constructor(private readonly config: ShoulderFormConfig) {}

  reset(): void {
    this.hold = [];
    this.zero = null;
  }

  current(): number | null {
    return this.zero;
  }

  observe(deg: number, t: number): void {
    const previous = this.hold[this.hold.length - 1];
    if (previous && (t < previous.t || t - previous.t > this.config.zeroMaxGapMs)) this.hold = [];
    if (deg > this.config.zeroMaxRestDeg) {
      this.hold = [];
      return;
    }
    this.hold.push({ t, deg });
    while (this.hold.length > 1 && t - this.hold[1]!.t >= this.config.zeroHoldMs) this.hold.shift();
    if (t - this.hold[0]!.t < this.config.zeroHoldMs || this.hold.length < MIN_HOLD_FRAMES) return;
    const values = this.hold.map((sample) => sample.deg);
    const middle = median(values);
    const close = values.filter((value) => Math.abs(value - middle) <= this.config.zeroStillnessDeg);
    if (close.length < values.length * STILL_SHARE) return;
    this.zero = this.zero === null ? middle : Math.min(this.zero, middle);
    this.hold = [];
  }
}

/** The rise of each arm in a shoulder raise, measured from that patient's own resting position. */
export class ShoulderFormMonitor {
  private readonly config: ShoulderFormConfig;
  private readonly axis = new ScreenAxisLock();
  private readonly zeros: Record<BodySide, ArmRestZero>;

  constructor(config: Partial<ShoulderFormConfig> = {}) {
    this.config = { ...VISION_CONFIG.shoulderForm, ...config };
    this.zeros = { left: new ArmRestZero(this.config), right: new ArmRestZero(this.config) };
  }

  reset(): void {
    this.startNewSet();
    this.zeros.left.reset();
    this.zeros.right.reset();
  }

  /** The next set. Same patient and same camera, so the resting position carries on. */
  startNewSet(): void {
    this.axis.reset();
  }

  update(pose: PoseResult | null, timestamp: number, _repCount: number, frameAspect?: number): ShoulderFormResult {
    return { frame: this.measure(pose, timestamp, frameAspect), faults: [], correctReps: 0, incorrectReps: 0 };
  }

  /** Watch for the resting position while nothing is shown, as in the countdown before a set. */
  observeStanding(pose: PoseResult | null, timestamp: number, frameAspect?: number): void {
    this.measure(pose, timestamp, frameAspect);
  }

  private measure(pose: PoseResult | null, timestamp: number, frameAspect?: number): ShoulderFormFrame | null {
    if (!pose) return null;
    const space = new LandmarkSpace(
      pose,
      frameAspect ?? pose.frameAspect ?? 16 / 9,
      this.config.minimumLandmarkVisibility,
    );
    const up = this.axis.update(bodyLengthAxis(space));
    // The same reading the rep counter uses, so the number and the count cannot disagree about the arm.
    const joints = calculateJointAngles(pose).joints;
    const armAngle: ShoulderFormFrame['armAngle'] = {};
    let zeroSet = false;
    let missingZero = false;
    for (const side of SIDES) {
      const reading = joints[JOINTS[side]];
      if (!reading.available || reading.angle === undefined) continue;
      const zero = this.zeros[side];
      zero.observe(reading.angle, timestamp);
      const rest = zero.current();
      if (rest === null) {
        armAngle[side] = round1(reading.angle);
        missingZero = true;
        continue;
      }
      zeroSet = true;
      const rise = Math.max(0, reading.angle - rest);
      armAngle[side] = rise <= this.config.zeroDeadbandDeg ? 0 : round1(rise);
    }
    return { armAngle, zeroSet: zeroSet && !missingZero, upImage: space.imageDirection(up) };
  }
}
