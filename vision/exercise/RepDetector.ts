import { VISION_CONFIG } from '../config';
import type { JointAnglesSnapshot } from '../types';
import {
  allAvailable,
  allInStartZone,
  allReachedTarget,
  anyMovingTowardStart,
  anyMovingTowardTarget,
  averageConcentricProgress,
  averageReturnProgress,
  evaluateRule,
  jointDisplayName,
  movementHint,
  concentricDirection,
  startRange,
  targetRange,
  type EvaluatedRule,
} from './ruleEvaluation';
import type { Exercise, RepDetectionResult, RepPhase, RuleStatus, TrackingRule } from './types';

type InternalPhase = 'idle_at_start' | 'concentric' | 'at_target' | 'eccentric';

interface RepDetectorConfig {
  startToleranceFactor: number;
  minTimeBetweenRepsMs: number;
  holdGraceMs: number;
  restCalibrationMs: number;
  restStabilityDeg: number;
  missedAttemptMinProgress: number;
}

const DEFAULT_CONFIG: RepDetectorConfig = VISION_CONFIG.repDetection;

function buildRuleStatusMap(evaluated: EvaluatedRule[]): Record<string, RuleStatus> {
  const rules: Record<string, RuleStatus> = {};
  for (const rule of evaluated) {
    rules[rule.joint] = {
      currentAngle: rule.currentAngle,
      targetAngle: rule.targetAngle,
      startAngle: rule.startAngle,
      satisfied: rule.satisfied,
      available: rule.available,
      reason: rule.unavailableReason,
      confidence: rule.confidence,
    };
  }
  return rules;
}

function maxHoldSeconds(exercise: Exercise): number {
  return exercise.trackingRules.reduce(
    (max, rule) => Math.max(max, rule.holdDurationSeconds ?? 0),
    0,
  );
}

function startToleranceForExercise(exercise: Exercise, config: RepDetectorConfig): number {
  return Math.max(
    ...exercise.trackingRules.map((rule) => rule.tolerance * config.startToleranceFactor),
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export type { RepDetectionResult, RepPhase, RuleStatus } from './types';

export class RepDetector {
  private readonly exercise: Exercise;
  private readonly config: RepDetectorConfig;
  private internalPhase: InternalPhase = 'idle_at_start';
  private repCount = 0;
  private holdStartedAt: number | null = null;
  private lastRepCompletedAt = 0;
  private repCycleStarted = false;
  private primedAtStart = false;
  private justCompletedRep = false;
  private holdComplete = false;
  private completed = false;
  /** Furthest angle each joint reached toward its target during the current attempt. */
  private attemptBest = new Map<string, number>();
  /** Why the last attempt did not count; shown until the next attempt starts. */
  private missedFeedback: string | null = null;
  /** Start windows adopted from the patient's own resting angle (see calibrateRest). */
  private restOverrides = new Map<string, { min: number; max: number }>();
  private restHold: { since: number; angles: Map<string, number> } | null = null;

  constructor(exercise: Exercise, config: Partial<RepDetectorConfig> = {}) {
    this.exercise = exercise;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getExercise(): Exercise {
    return this.exercise;
  }

  getRepCount(): number {
    return this.repCount;
  }

  reset(): void {
    this.internalPhase = 'idle_at_start';
    this.repCount = 0;
    this.holdStartedAt = null;
    this.lastRepCompletedAt = 0;
    this.repCycleStarted = false;
    this.primedAtStart = false;
    this.justCompletedRep = false;
    this.holdComplete = false;
    this.completed = false;
    this.attemptBest.clear();
    this.missedFeedback = null;
    this.restOverrides.clear();
    this.restHold = null;
  }

  markCompleted(): void {
    this.completed = true;
    this.internalPhase = 'idle_at_start';
    this.holdStartedAt = null;
  }

  update(snapshot: JointAnglesSnapshot): RepDetectionResult {
    if (this.exercise.modality === 'hand_trace') {
      return this.buildResult(
        snapshot,
        'READY',
        0,
        'Trace shapes with your index fingertip',
        true,
        [],
      );
    }

    if (this.completed) {
      return this.buildResult(snapshot, 'READY', 1, 'Exercise complete', true, []);
    }

    if (this.justCompletedRep) {
      this.justCompletedRep = false;
      const evaluated = this.evaluate(snapshot);
      // Still advance on this frame: dropping it lost the deepest point of a quick next rep.
      if (allAvailable(evaluated)) this.advanceState(evaluated, snapshot.timestamp);
      return this.buildResult(snapshot, 'REP_COMPLETED', 1, 'Good', true, evaluated);
    }

    let evaluated = this.evaluate(snapshot);
    if (!this.primedAtStart && allAvailable(evaluated) && this.calibrateRest(evaluated, snapshot.timestamp)) {
      evaluated = this.evaluate(snapshot);
    }

    if (!allAvailable(evaluated)) {
      const phase = this.publicPhaseForInternal(this.internalPhase);
      return this.buildResult(
        snapshot,
        phase,
        this.phaseProgress(this.internalPhase, evaluated, snapshot.timestamp),
        this.feedbackForUnavailable(evaluated),
        false,
        evaluated,
      );
    }

    this.advanceState(evaluated, snapshot.timestamp);

    const phase = this.publicPhaseForInternal(this.internalPhase);
    const valid = this.isPhaseValid(this.internalPhase, evaluated, snapshot.timestamp);
    const progress = this.phaseProgress(this.internalPhase, evaluated, snapshot.timestamp);
    const feedback = this.buildFeedback(this.internalPhase, evaluated, snapshot.timestamp, valid);

    return this.buildResult(snapshot, phase, progress, feedback, valid, evaluated);
  }

  private evaluate(snapshot: JointAnglesSnapshot): EvaluatedRule[] {
    const startTolerance = startToleranceForExercise(this.exercise, this.config);
    return this.effectiveRules().map((rule) =>
      evaluateRule(rule, snapshot.joints[rule.joint], startTolerance),
    );
  }

  /** Tracking rules with any adopted personal start window applied. */
  private effectiveRules(): TrackingRule[] {
    return this.exercise.trackingRules.map((rule) => {
      const override = this.restOverrides.get(rule.joint);
      return override ? { ...rule, startRange: override } : rule;
    });
  }

  /**
   * Elderly and rehab patients may rest outside the configured start range (knees that only
   * straighten to 130°). When every joint holds still, clearly on the rest side of its target,
   * for `restCalibrationMs`, that resting angle becomes its start window. "Clearly" means at
   * least one target-window width away, so start and target can never overlap. Returns true
   * when a window was adopted this frame.
   */
  private calibrateRest(evaluated: EvaluatedRule[], timestamp: number): boolean {
    if (allInStartZone(evaluated)) {
      this.restHold = null;
      return false;
    }
    const band = this.config.restStabilityDeg;
    const hold = this.restHold;
    const still =
      hold !== null &&
      evaluated.every(
        (rule) =>
          rule.currentAngle !== undefined &&
          Math.abs(rule.currentAngle - (hold.angles.get(rule.joint) ?? Number.NaN)) <= band,
      );
    if (!hold || !still) {
      this.restHold = {
        since: timestamp,
        angles: new Map(evaluated.map((rule) => [rule.joint, rule.currentAngle ?? Number.NaN])),
      };
      return false;
    }
    if (timestamp - hold.since < this.config.restCalibrationMs) return false;

    const windows = new Map<string, { min: number; max: number }>();
    for (const rule of this.exercise.trackingRules) {
      const angle = hold.angles.get(rule.joint);
      if (angle === undefined || !Number.isFinite(angle)) return false;
      const target = targetRange(rule);
      const width = Math.max(1, target.max - target.min);
      if (concentricDirection(rule) === 'decreasing') {
        if (angle < target.max + width) return false;
        windows.set(rule.joint, { min: Math.max(target.max + 1, angle - band), max: 180 });
      } else {
        if (angle > target.min - width) return false;
        windows.set(rule.joint, { min: 0, max: Math.min(target.min - 1, angle + band) });
      }
    }
    this.restOverrides = windows;
    this.restHold = null;
    return true;
  }

  private advanceState(evaluated: EvaluatedRule[], timestamp: number): void {
    const holdSeconds = maxHoldSeconds(this.exercise);
    const atStart = allInStartZone(evaluated);
    // Reaching the window, or going through it and beyond, both count as reaching the target.
    const atTarget = allReachedTarget(evaluated);

    switch (this.internalPhase) {
      case 'idle_at_start': {
        if (atStart) {
          this.primedAtStart = true;
          this.repCycleStarted = false;
          break;
        }
        if (this.primedAtStart) {
          this.repCycleStarted = true;
          this.internalPhase = 'concentric';
          this.attemptBest.clear();
          this.missedFeedback = null;
          this.trackAttempt(evaluated);
        }
        break;
      }
      case 'concentric': {
        this.trackAttempt(evaluated);
        if (atTarget) {
          this.holdStartedAt = timestamp;
          if (holdSeconds <= 0) {
            this.holdComplete = true;
            this.internalPhase = 'eccentric';
          } else {
            this.internalPhase = 'at_target';
          }
          break;
        }
        if (atStart) {
          this.missedFeedback = this.describeMissedAttempt();
          this.internalPhase = 'idle_at_start';
          this.repCycleStarted = false;
          this.primedAtStart = true;
          this.holdStartedAt = null;
          this.holdComplete = false;
        }
        break;
      }
      case 'at_target': {
        if (!atTarget) {
          this.holdStartedAt = null;
          this.internalPhase = this.holdComplete ? 'eccentric' : 'concentric';
          this.holdComplete = false;
          break;
        }
        if (this.holdStartedAt !== null && timestamp - this.holdStartedAt >= holdSeconds * 1000) {
          this.holdComplete = true;
          this.internalPhase = 'eccentric';
        }
        break;
      }
      case 'eccentric': {
        if (atStart) {
          const sinceLastRep = timestamp - this.lastRepCompletedAt;
          if (
            sinceLastRep >= this.config.minTimeBetweenRepsMs &&
            this.repCycleStarted
          ) {
            this.repCount += 1;
            this.lastRepCompletedAt = timestamp;
            this.justCompletedRep = true;
            if (this.repCount >= this.exercise.recommendedReps) {
              this.completed = true;
            }
          }
          this.internalPhase = 'idle_at_start';
          this.repCycleStarted = false;
          this.primedAtStart = true;
          this.holdStartedAt = null;
        }
        break;
      }
      default:
        break;
    }
  }

  /** Remember how far each joint got toward its target during this attempt. */
  private trackAttempt(evaluated: EvaluatedRule[]): void {
    for (const rule of evaluated) {
      if (!rule.available || rule.currentAngle === undefined) continue;
      const source = this.effectiveRules().find((entry) => entry.joint === rule.joint);
      if (!source) continue;
      const decreasing = concentricDirection(source) === 'decreasing';
      const previous = this.attemptBest.get(rule.joint);
      const better =
        previous === undefined ||
        (decreasing ? rule.currentAngle < previous : rule.currentAngle > previous);
      if (better) this.attemptBest.set(rule.joint, rule.currentAngle);
    }
  }

  /** "Rep not counted: right knee reached 106° (needs 80–100°)" for each joint that fell short. */
  private describeMissedAttempt(): string | null {
    const rules = this.effectiveRules();
    // Only a deliberate attempt is worth explaining: some joint must have covered enough of
    // the way from its start zone to its target window.
    const progress = rules.map((rule) => {
      const best = this.attemptBest.get(rule.joint);
      if (best === undefined) return 0;
      const target = targetRange(rule);
      const start = startRange(rule, 0);
      return concentricDirection(rule) === 'decreasing'
        ? (start.min - best) / Math.max(1, start.min - target.max)
        : (best - start.max) / Math.max(1, target.min - start.max);
    });
    if (Math.max(...progress) < this.config.missedAttemptMinProgress) return null;

    const short: string[] = [];
    for (const rule of rules) {
      const best = this.attemptBest.get(rule.joint);
      if (best === undefined) continue;
      const range = targetRange(rule);
      const decreasing = concentricDirection(rule) === 'decreasing';
      const reached = decreasing ? best <= range.max : best >= range.min;
      if (!reached) {
        short.push(
          `${jointDisplayName(rule.joint)} reached ${Math.round(best)}° (needs ${Math.round(range.min)}–${Math.round(range.max)}°)`,
        );
      }
    }
    return short.length > 0 ? `Rep not counted: ${short.join(', ')}` : null;
  }

  private publicPhaseForInternal(phase: InternalPhase): RepPhase {
    switch (phase) {
      case 'idle_at_start':
        return 'READY';
      case 'concentric':
        return 'MOVING_TO_TARGET';
      case 'at_target': {
        const holdSeconds = maxHoldSeconds(this.exercise);
        if (holdSeconds > 0 && !this.holdComplete) return 'HOLDING';
        return 'TARGET_REACHED';
      }
      case 'eccentric':
        return 'RETURNING';
      default:
        return 'READY';
    }
  }

  private isPhaseValid(
    phase: InternalPhase,
    evaluated: EvaluatedRule[],
    timestamp: number,
  ): boolean {
    switch (phase) {
      case 'idle_at_start':
        return allInStartZone(evaluated);
      case 'concentric':
        return anyMovingTowardTarget(evaluated) || averageConcentricProgress(evaluated) > 0.05;
      case 'at_target': {
        if (!allReachedTarget(evaluated)) return false;
        const holdSeconds = maxHoldSeconds(this.exercise);
        if (holdSeconds <= 0) return true;
        return (
          this.holdStartedAt !== null &&
          timestamp - this.holdStartedAt >= holdSeconds * 1000 - this.config.holdGraceMs
        );
      }
      case 'eccentric':
        return anyMovingTowardStart(evaluated) || averageReturnProgress(evaluated) > 0.05;
      default:
        return false;
    }
  }

  private phaseProgress(
    phase: InternalPhase,
    evaluated: EvaluatedRule[],
    timestamp: number,
  ): number {
    switch (phase) {
      case 'idle_at_start':
        return allInStartZone(evaluated) ? 1 : clamp01(averageReturnProgress(evaluated));
      case 'concentric':
        return clamp01(averageConcentricProgress(evaluated));
      case 'at_target': {
        const holdSeconds = maxHoldSeconds(this.exercise);
        if (holdSeconds <= 0) return 1;
        if (this.holdStartedAt === null) return 0;
        return clamp01((timestamp - this.holdStartedAt) / (holdSeconds * 1000));
      }
      case 'eccentric':
        return clamp01(averageReturnProgress(evaluated));
      default:
        return 0;
    }
  }

  private feedbackForUnavailable(evaluated: EvaluatedRule[]): string {
    const blocked = evaluated.find((rule) => !rule.available);
    if (!blocked) return 'Hold';
    return `Keep your ${jointDisplayName(blocked.joint)} visible to the camera`;
  }

  private buildFeedback(
    phase: InternalPhase,
    evaluated: EvaluatedRule[],
    timestamp: number,
    valid: boolean,
  ): string {
    if (phase === 'idle_at_start') {
      if (this.missedFeedback) return this.missedFeedback;
      if (!this.primedAtStart) return 'Return to starting position';
      if (allInStartZone(evaluated)) return 'Good';
      return 'Return to starting position';
    }

    if (phase === 'concentric') {
      const lagging = [...evaluated]
        .filter((rule) => rule.available && !rule.inTargetZone && !rule.pastTargetZone)
        .sort((a, b) => a.concentricProgress - b.concentricProgress)[0];
      if (lagging) {
        const rule = this.exercise.trackingRules.find((entry) => entry.joint === lagging.joint);
        if (rule) return movementHint(rule, lagging);
      }
      return 'Move toward target position';
    }

    if (phase === 'at_target') {
      const holdSeconds = maxHoldSeconds(this.exercise);
      if (holdSeconds > 0 && this.holdStartedAt !== null) {
        if (timestamp - this.holdStartedAt < holdSeconds * 1000) return 'Hold';
      }
      return valid ? 'Good' : 'Hold at target position';
    }

    if (phase === 'eccentric') {
      return 'Return to starting position';
    }

    return 'Good';
  }

  private buildResult(
    snapshot: JointAnglesSnapshot,
    phase: RepPhase,
    progress: number,
    feedback: string,
    valid: boolean,
    evaluated: EvaluatedRule[],
  ): RepDetectionResult {
    void snapshot;
    return {
      exerciseId: this.exercise.id,
      repCount: this.repCount,
      targetReps: this.exercise.recommendedReps,
      phase,
      valid,
      progress: clamp01(progress),
      feedback,
      rules: buildRuleStatusMap(evaluated),
      completed: this.completed,
    };
  }
}
