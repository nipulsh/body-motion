import { VISION_CONFIG } from '../config';
import type { JointAnglesSnapshot } from '../types';
import {
  allAvailable,
  allInStartZone,
  allInTargetZone,
  anyMovingTowardStart,
  anyMovingTowardTarget,
  averageConcentricProgress,
  averageReturnProgress,
  evaluateRule,
  jointDisplayName,
  movementHint,
  type EvaluatedRule,
} from './ruleEvaluation';
import type { Exercise, RepDetectionResult, RepPhase, RuleStatus } from './types';

type InternalPhase = 'idle_at_start' | 'concentric' | 'at_target' | 'eccentric';

interface RepDetectorConfig {
  startToleranceFactor: number;
  minTimeBetweenRepsMs: number;
  holdGraceMs: number;
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
      return this.buildResult(snapshot, 'REP_COMPLETED', 1, 'Good', true, evaluated);
    }

    const evaluated = this.evaluate(snapshot);

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
    return this.exercise.trackingRules.map((rule) =>
      evaluateRule(rule, snapshot.joints[rule.joint], startTolerance),
    );
  }

  private advanceState(evaluated: EvaluatedRule[], timestamp: number): void {
    const holdSeconds = maxHoldSeconds(this.exercise);
    const atStart = allInStartZone(evaluated);
    const atTarget = allInTargetZone(evaluated);

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
        }
        break;
      }
      case 'concentric': {
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
        if (!allInTargetZone(evaluated)) return false;
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
      if (!this.primedAtStart) return 'Return to starting position';
      if (allInStartZone(evaluated)) return 'Good';
      return 'Return to starting position';
    }

    if (phase === 'concentric') {
      const lagging = [...evaluated]
        .filter((rule) => rule.available && !rule.inTargetZone)
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
