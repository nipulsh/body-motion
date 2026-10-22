import { VISION_CONFIG } from '../config';
import { unwrapDelta, wrapSigned180 } from '../math/angles';
import type { RotationDebugInfo, RotationDirection, RotationState } from '../types';

export interface RotationTrackerOptions {
  smoothingAlpha?: number;
  maxOrientationJumpDeg?: number;
  maxUnwrappedStepDeg?: number;
  maxAngularVelocityDegPerSec?: number;
  deadzoneDeg?: number;
  processingFps?: number;
  rotationCompleteDeg?: number;
  debug?: boolean;
}

export class RotationTracker {
  private rawAngle = 0;
  private smoothedAngle = 0;
  private previousSigned = 0;
  private unwrappedAngle = 0;
  private scanStartUnwrapped = 0;
  private hasSample = false;
  private scanStartCaptured = false;
  private direction: RotationDirection = 'unknown';
  private lastTimestampMs: number | null = null;
  private lastDelta = 0;
  private lastAccepted = true;
  private orientationConfidence = 1;
  private poseConfidence = 1;
  private readonly smoothingAlpha: number;
  private readonly maxOrientationJumpDeg: number;
  private readonly maxUnwrappedStepDeg: number;
  private readonly maxAngularVelocityDegPerSec: number;
  private readonly deadzoneDeg: number;
  private readonly processingFps: number;
  private readonly rotationCompleteDeg: number;
  private readonly debug: boolean;

  constructor(options?: RotationTrackerOptions) {
    this.smoothingAlpha = options?.smoothingAlpha ?? 1;
    this.maxOrientationJumpDeg =
      options?.maxOrientationJumpDeg ?? VISION_CONFIG.motion.maxOrientationJumpDeg;
    this.maxUnwrappedStepDeg =
      options?.maxUnwrappedStepDeg ?? VISION_CONFIG.motion.maxUnwrappedStepDeg;
    this.maxAngularVelocityDegPerSec =
      options?.maxAngularVelocityDegPerSec ?? VISION_CONFIG.motion.maxAngularVelocityDegPerSec;
    this.deadzoneDeg = options?.deadzoneDeg ?? VISION_CONFIG.motion.rotationDeadzoneDeg;
    this.processingFps = options?.processingFps ?? VISION_CONFIG.motion.processingFps;
    this.rotationCompleteDeg =
      options?.rotationCompleteDeg ?? VISION_CONFIG.completion.rotationCompleteDeg;
    this.debug = options?.debug ?? VISION_CONFIG.debug.rotation;
  }

  update(
    angleDeg: number,
    extras?: {
      timestampMs?: number;
      orientationConfidence?: number;
      poseConfidence?: number;
    },
  ): RotationState {
    const rawSigned = wrapSigned180(angleDeg);
    this.rawAngle = rawSigned;
    this.orientationConfidence = extras?.orientationConfidence ?? this.orientationConfidence;
    this.poseConfidence = extras?.poseConfidence ?? this.poseConfidence;

    if (!this.hasSample) {
      this.hasSample = true;
      this.smoothedAngle = rawSigned;
      this.previousSigned = rawSigned;
      this.unwrappedAngle = angleDeg;
      this.scanStartUnwrapped = this.unwrappedAngle;
      this.lastTimestampMs = extras?.timestampMs ?? null;
      this.lastDelta = 0;
      this.lastAccepted = true;
      this.logDebug(rawSigned, 0, rawSigned);
      return this.snapshot();
    }

    const dtSec =
      extras?.timestampMs !== undefined && this.lastTimestampMs !== null
        ? Math.max(1e-3, (extras.timestampMs - this.lastTimestampMs) / 1000)
        : 1 / this.processingFps;

    const proposed = unwrapDelta(this.previousSigned, rawSigned);
    const maxDelta = Math.min(
      this.maxUnwrappedStepDeg,
      Math.max(this.maxOrientationJumpDeg, this.maxAngularVelocityDegPerSec * dtSec),
    );

    if (Math.abs(proposed) > maxDelta) {
      this.lastDelta = proposed;
      this.lastAccepted = false;
      this.orientationConfidence = Math.min(this.orientationConfidence, 0.25);
      if (extras?.timestampMs !== undefined) this.lastTimestampMs = extras.timestampMs;
      this.logDebug(rawSigned, proposed, this.previousSigned);
      return this.snapshot();
    }

    this.lastAccepted = true;
    if (extras?.timestampMs !== undefined) this.lastTimestampMs = extras.timestampMs;

    const previousForLog = this.previousSigned;
    const alpha = this.smoothingAlpha;
    this.smoothedAngle =
      alpha >= 1 ? rawSigned : wrapSigned180(this.smoothedAngle + proposed * alpha);

    const delta = unwrapDelta(this.previousSigned, this.smoothedAngle);
    this.previousSigned = this.smoothedAngle;
    this.lastDelta = delta;

    if (Math.abs(delta) < this.deadzoneDeg) {
      this.logDebug(rawSigned, delta, previousForLog);
      return this.snapshot();
    }

    this.unwrappedAngle += delta;
    this.updateDirection();
    this.logDebug(rawSigned, delta, previousForLog);
    return this.snapshot();
  }

  /**
   * Treat the current unwrapped heading as scan 0°. Further change is relative
   * to this pose so the user does not need to face a perfect mathematical front.
   */
  captureScanStart(): void {
    this.scanStartUnwrapped = this.unwrappedAngle;
    this.scanStartCaptured = true;
    this.direction = 'unknown';
  }

  reset(): void {
    this.rawAngle = 0;
    this.smoothedAngle = 0;
    this.previousSigned = 0;
    this.unwrappedAngle = 0;
    this.scanStartUnwrapped = 0;
    this.hasSample = false;
    this.scanStartCaptured = false;
    this.direction = 'unknown';
    this.lastTimestampMs = null;
    this.lastDelta = 0;
    this.lastAccepted = true;
    this.orientationConfidence = 1;
    this.poseConfidence = 1;
  }

  getState(): RotationState {
    return this.snapshot();
  }

  getDebug(): RotationDebugInfo {
    return this.debugSnapshot();
  }

  isCompleted(): boolean {
    return this.scanStartCaptured && Math.abs(this.cumulative()) >= this.rotationCompleteDeg;
  }

  private cumulative(): number {
    return this.unwrappedAngle - this.scanStartUnwrapped;
  }

  private updateDirection(): void {
    const cumulative = this.cumulative();
    if (Math.abs(cumulative) < VISION_CONFIG.motion.directionConfirmDeg) {
      this.direction = 'unknown';
      return;
    }
    this.direction = cumulative > 0 ? 'clockwise' : 'counterclockwise';
  }

  private snapshot(): RotationState {
    const cumulativeRotation = this.cumulative();
    const abs = Math.abs(cumulativeRotation);
    return {
      rawAngle: this.rawAngle,
      unwrappedAngle: this.unwrappedAngle,
      cumulativeRotation,
      rotationProgress: Math.min(1, abs / 360),
      direction: this.direction,
      completed: this.scanStartCaptured && abs >= this.rotationCompleteDeg,
      confidence: this.lastAccepted
        ? Math.min(this.orientationConfidence, this.poseConfidence)
        : Math.min(0.25, this.orientationConfidence),
    };
  }

  private debugSnapshot(): RotationDebugInfo {
    const state = this.snapshot();
    return {
      rawAngle: state.rawAngle,
      smoothedAngle: this.smoothedAngle,
      unwrappedAngle: state.unwrappedAngle,
      cumulativeRotation: state.cumulativeRotation,
      rotationProgress: state.rotationProgress,
      direction: state.direction,
      poseConfidence: this.poseConfidence,
      orientationConfidence: this.orientationConfidence,
      frameDelta: this.lastDelta,
      previousAngle: this.previousSigned,
      timestamp: this.lastTimestampMs ?? 0,
    };
  }

  private logDebug(raw: number, delta: number, previous: number): void {
    if (!this.debug) return;
    const sign = delta >= 0 ? '+' : '';
    console.debug(
      `[Rotation]\nraw: ${raw.toFixed(1)}\nprevious: ${previous.toFixed(1)}\ndelta: ${sign}${delta.toFixed(1)}\nunwrapped: ${this.unwrappedAngle.toFixed(1)}\ncumulative: ${this.cumulative().toFixed(1)}`,
    );
  }
}
