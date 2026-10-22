import { TRACKABLE_JOINTS } from '../pose/jointAngles';
import type { JointAngleReading, JointAnglesSnapshot, TrackableJointName } from '../types';
import { concentricDirection } from './ruleEvaluation';
import type { Exercise, TrackingRule } from './types';

export function makeTrackingRule(overrides: Partial<TrackingRule> & Pick<TrackingRule, 'joint'>): TrackingRule {
  return {
    startAngle: 170,
    requiredAngle: 90,
    minimumAngle: 45,
    maximumAngle: 180,
    tolerance: 10,
    movement: 'flexion',
    startingPosition: 'Start',
    targetPosition: 'Target',
    ...overrides,
  };
}

export function makeExercise(overrides: Partial<Exercise> & Pick<Exercise, 'id'>): Exercise {
  return {
    name: 'Test Exercise',
    description: 'Test',
    targetBodyParts: ['elbow'],
    difficulty: 'beginner',
    sets: 3,
    recommendedReps: 5,
    restSeconds: 30,
    instructions: ['Move slowly'],
    safetyNotes: ['Stop if pain occurs'],
    trackingRules: [makeTrackingRule({ joint: 'left_elbow' })],
    ...overrides,
  };
}

export function angleReading(angle: number, confidence = 0.95): JointAngleReading {
  return { available: true, angle, confidence };
}

export function unavailableReading(
  reason: 'MISSING_LANDMARK' | 'LOW_CONFIDENCE' | 'SUDDEN_JUMP' = 'MISSING_LANDMARK',
): JointAngleReading {
  return { available: false, reason, confidence: 0.2 };
}

export function snapshotWithAngles(
  angles: Partial<Record<TrackableJointName, number | JointAngleReading>>,
  timestamp = 0,
): JointAnglesSnapshot {
  const joints = {} as Record<TrackableJointName, JointAngleReading>;
  for (const joint of TRACKABLE_JOINTS) {
    const value = angles[joint];
    if (value === undefined) {
      joints[joint] = unavailableReading('MISSING_LANDMARK');
    } else if (typeof value === 'number') {
      joints[joint] = angleReading(value);
    } else {
      joints[joint] = value;
    }
  }
  return {
    timestamp,
    coordinateSpace: 'image',
    joints,
  };
}

/** Simulate a full valid rep for a single-joint flexion rule (start > target). */
export function simulateSingleJointRep(
  update: (snapshot: JointAnglesSnapshot) => void,
  joint: TrackableJointName,
  rule: TrackingRule,
  options?: { holdMs?: number; startAt?: number },
): void {
  const startAt = options?.startAt ?? 0;
  let t = startAt;

  update(snapshotWithAngles({ [joint]: rule.startAngle }, t));
  t += 100;
  update(snapshotWithAngles({ [joint]: rule.startAngle - 20 }, t));
  t += 100;
  update(snapshotWithAngles({ [joint]: rule.requiredAngle }, t));

  const holdMs = options?.holdMs ?? (rule.holdDurationSeconds ?? 0) * 1000;
  if (holdMs > 0) {
    t += holdMs;
    update(snapshotWithAngles({ [joint]: rule.requiredAngle }, t));
  }

  t += 100;
  update(snapshotWithAngles({ [joint]: rule.requiredAngle + 20 }, t));
  t += 100;
  update(snapshotWithAngles({ [joint]: rule.startAngle }, t));
  t += 600;
  update(snapshotWithAngles({ [joint]: rule.startAngle }, t));
}

/** Reference shoulder abduction rule for calibration tests. */
export function makeShoulderAbductionRule(
  side: 'left' | 'right' = 'right',
): TrackingRule {
  const joint = side === 'left' ? 'left_shoulder' : 'right_shoulder';
  return makeTrackingRule({
    joint,
    movement: 'abduction',
    startAngle: 20,
    requiredAngle: 90,
    minimumAngle: 10,
    maximumAngle: 120,
    tolerance: 12,
    startingPosition: 'Arm resting at side',
    targetPosition: 'Arm at shoulder height (~90°)',
    holdDurationSeconds: 1,
  });
}

export function makeShoulderAbductionExercise(
  side: 'left' | 'right' = 'right',
  overrides: Partial<Exercise> = {},
): Exercise {
  return makeExercise({
    id: side === 'left' ? 'shoulder_abduction_left' : 'shoulder_abduction_right',
    name: 'Shoulder Abduction',
    description: 'Raise your arm out to the side to shoulder height.',
    targetBodyParts: ['shoulder'],
    trackingRules: [makeShoulderAbductionRule(side)],
    recommendedReps: 10,
    ...overrides,
  });
}

/** Simulate a rep respecting increasing vs decreasing concentric direction. */
export function simulateDirectionalJointRep(
  update: (snapshot: JointAnglesSnapshot) => void,
  joint: TrackableJointName,
  rule: TrackingRule,
  options?: { holdMs?: number; startAt?: number },
): void {
  const direction = concentricDirection(rule);
  if (direction === 'increasing') {
    simulateIncreasingJointRep(update, joint, rule, options);
    return;
  }
  simulateSingleJointRep(update, joint, rule, options);
}

function simulateIncreasingJointRep(
  update: (snapshot: JointAnglesSnapshot) => void,
  joint: TrackableJointName,
  rule: TrackingRule,
  options?: { holdMs?: number; startAt?: number },
): void {
  const startAt = options?.startAt ?? 0;
  let t = startAt;
  const mid = rule.startAngle + Math.max(10, (rule.requiredAngle - rule.startAngle) * 0.5);

  update(snapshotWithAngles({ [joint]: rule.startAngle }, t));
  t += 100;
  update(snapshotWithAngles({ [joint]: mid }, t));
  t += 100;
  update(snapshotWithAngles({ [joint]: rule.requiredAngle }, t));

  const holdMs = options?.holdMs ?? (rule.holdDurationSeconds ?? 0) * 1000;
  if (holdMs > 0) {
    t += holdMs;
    update(snapshotWithAngles({ [joint]: rule.requiredAngle }, t));
  }

  t += 100;
  update(snapshotWithAngles({ [joint]: mid }, t));
  t += 100;
  update(snapshotWithAngles({ [joint]: rule.startAngle }, t));
  t += 600;
  update(snapshotWithAngles({ [joint]: rule.startAngle }, t));
}
