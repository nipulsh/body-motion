import type { JointAngleReading, TrackableJointName } from '../types';
import type { TrackingRule } from './types';

export interface EvaluatedRule {
  joint: TrackableJointName;
  available: boolean;
  unavailableReason?: string;
  currentAngle?: number;
  confidence?: number;
  startAngle: number;
  targetAngle: number;
  inStartZone: boolean;
  inTargetZone: boolean;
  /** 0–1 progress from start toward target along the concentric path. */
  concentricProgress: number;
  /** 0–1 progress from target back toward start. */
  returnProgress: number;
  satisfied: boolean;
}

export function concentricDirection(rule: TrackingRule): 'increasing' | 'decreasing' {
  return rule.requiredAngle >= rule.startAngle ? 'increasing' : 'decreasing';
}

export function targetRange(rule: TrackingRule): { min: number; max: number } {
  // Hit-test the required angle ± tolerance. Clamping that band to minimum/maximum
  // made a reached target miss when those bounds were a tight box around only one pose.
  const tolerance = Math.max(0, rule.tolerance);
  return {
    min: Math.max(0, rule.requiredAngle - tolerance),
    max: Math.min(180, rule.requiredAngle + tolerance),
  };
}

export function startRange(rule: TrackingRule, startTolerance: number): { min: number; max: number } {
  // Rest poses sit past the nominal start: a straight elbow measures ~180° even when
  // startAngle is 165°, and an arm at the side can be near 0° when startAngle is 20°.
  // The old ±tolerance window, clipped by minimum/maximum, excluded those readings,
  // so the rep never primed. Keep the window on the rest side of the target only.
  const tolerance = Math.max(0, startTolerance);
  const target = targetRange(rule);
  if (concentricDirection(rule) === 'increasing') {
    const maxTowardTarget = Math.min(rule.startAngle + tolerance, target.min);
    return {
      min: 0,
      max: Math.max(rule.startAngle, maxTowardTarget),
    };
  }
  const minTowardTarget = Math.max(rule.startAngle - tolerance, target.max);
  return {
    min: Math.min(rule.startAngle, minTowardTarget),
    max: 180,
  };
}

export function isAngleInRange(angle: number, range: { min: number; max: number }): boolean {
  return angle >= range.min && angle <= range.max;
}

export function evaluateRule(
  rule: TrackingRule,
  reading: JointAngleReading | undefined,
  startTolerance: number,
): EvaluatedRule {
  const target = targetRange(rule);
  const start = startRange(rule, startTolerance);
  const base = {
    joint: rule.joint,
    startAngle: rule.startAngle,
    targetAngle: rule.requiredAngle,
    inStartZone: false,
    inTargetZone: false,
    concentricProgress: 0,
    returnProgress: 0,
    satisfied: false,
  };

  if (!reading) {
    return {
      ...base,
      available: false,
      unavailableReason: 'MISSING_LANDMARK',
    };
  }

  if (!reading.available) {
    return {
      ...base,
      available: false,
      unavailableReason: reading.reason,
      confidence: reading.confidence,
    };
  }

  const angle = reading.angle;
  const inStartZone = isAngleInRange(angle, start);
  const inTargetZone = isAngleInRange(angle, target);
  const direction = concentricDirection(rule);
  const span = Math.abs(rule.startAngle - rule.requiredAngle);

  let concentricProgress = 0;
  if (span > 0) {
    if (direction === 'decreasing') {
      concentricProgress = (rule.startAngle - angle) / (rule.startAngle - rule.requiredAngle);
    } else {
      concentricProgress = (angle - rule.startAngle) / (rule.requiredAngle - rule.startAngle);
    }
    concentricProgress = clamp01(concentricProgress);
  } else {
    concentricProgress = inTargetZone ? 1 : 0;
  }

  let returnProgress = 0;
  if (span > 0) {
    if (direction === 'decreasing') {
      returnProgress = (angle - rule.requiredAngle) / (rule.startAngle - rule.requiredAngle);
    } else {
      returnProgress = (rule.requiredAngle - angle) / (rule.requiredAngle - rule.startAngle);
    }
    returnProgress = clamp01(returnProgress);
  } else {
    returnProgress = inStartZone ? 1 : 0;
  }

  return {
    ...base,
    available: true,
    currentAngle: angle,
    confidence: reading.confidence,
    inStartZone,
    inTargetZone,
    concentricProgress,
    returnProgress,
    satisfied: inTargetZone,
  };
}

export function allAvailable(rules: EvaluatedRule[]): boolean {
  return rules.every((rule) => rule.available);
}

export function allInStartZone(rules: EvaluatedRule[]): boolean {
  return allAvailable(rules) && rules.every((rule) => rule.inStartZone);
}

export function allInTargetZone(rules: EvaluatedRule[]): boolean {
  return allAvailable(rules) && rules.every((rule) => rule.inTargetZone);
}

export function anyMovingTowardTarget(rules: EvaluatedRule[]): boolean {
  return rules.some((rule) => rule.available && rule.concentricProgress > 0.05 && !rule.inTargetZone);
}

export function anyMovingTowardStart(rules: EvaluatedRule[]): boolean {
  return rules.some((rule) => rule.available && rule.returnProgress > 0.05 && !rule.inStartZone);
}

export function averageConcentricProgress(rules: EvaluatedRule[]): number {
  const available = rules.filter((rule) => rule.available);
  if (available.length === 0) return 0;
  return available.reduce((sum, rule) => sum + rule.concentricProgress, 0) / available.length;
}

export function averageReturnProgress(rules: EvaluatedRule[]): number {
  const available = rules.filter((rule) => rule.available);
  if (available.length === 0) return 0;
  return available.reduce((sum, rule) => sum + rule.returnProgress, 0) / available.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function jointDisplayName(joint: TrackableJointName): string {
  return joint.replace(/_/g, ' ');
}

export function movementHint(rule: TrackingRule, evaluated: EvaluatedRule): string {
  if (!evaluated.available || evaluated.currentAngle === undefined) {
    return `Keep your ${jointDisplayName(rule.joint)} visible to the camera`;
  }

  const target = targetRange(rule);
  if (evaluated.currentAngle < target.min) {
    switch (rule.movement) {
      case 'abduction':
        return `Raise your ${jointDisplayName(rule.joint)} out to the side`;
      case 'flexion':
      case 'adduction':
      case 'elevation':
        return `Move your ${jointDisplayName(rule.joint)} further into ${rule.movement}`;
      default:
        return `Increase ${jointDisplayName(rule.joint)} angle toward target`;
    }
  }

  if (evaluated.currentAngle > target.max) {
    return `Reduce ${jointDisplayName(rule.joint)} angle toward target`;
  }

  return `Keep your ${jointDisplayName(rule.joint)} steady`;
}
