import type { TrackableJointName } from '../types';
import type { Exercise, TrackingRule } from './types';

/**
 * Rep-counting angle ranges — the single place to tune when a rep counts.
 *
 * Every angle is the interior joint angle the tracker measures between two body segments
 * (so it does not depend on camera tilt):
 *   - knee      hip → knee → ankle            180° = straight leg, 90° = right angle
 *   - elbow     shoulder → elbow → wrist      180° = straight arm
 *   - shoulder  hip → shoulder → elbow        0° = arm at the side, 90° = arm level with shoulder
 *   - hip       shoulder → hip → knee         180° = standing tall
 *   - spine     shoulder mid → hip mid → knee mid   180° = standing tall, smaller = hinged forward
 *
 * A rep counts when every tracked joint starts inside its `start` range, moves into its
 * `target` range (e.g. squat knees between 80° and 100°), then returns to `start`.
 */
export interface AngleRange {
  min: number;
  max: number;
}

export interface JointRepRange {
  /** Resting / starting position. The rep is armed here and completes when the joint returns. */
  start: AngleRange;
  /** Position the joint must reach for the rep to count. */
  target: AngleRange;
}

export type ExerciseAngleRanges = Partial<Record<TrackableJointName, JointRepRange>>;

// Standing starts at 145°, not 160°: many rehab and older patients cannot fully straighten
// their knees, and 145° is still clearly standing next to an 80–100° target.

// ---- Squat -----------------------------------------------------------------
export const SQUAT_KNEE_START: AngleRange = { min: 145, max: 180 };
export const SQUAT_KNEE_TARGET: AngleRange = { min: 80, max: 100 };

// ---- Lunge -----------------------------------------------------------------
export const LUNGE_KNEE_START: AngleRange = { min: 145, max: 180 };
export const LUNGE_FRONT_KNEE_TARGET: AngleRange = { min: 80, max: 100 };
export const LUNGE_BACK_KNEE_TARGET: AngleRange = { min: 85, max: 125 };

// ---- Elbow flexion (biceps curl) ------------------------------------------
export const ELBOW_FLEXION_START: AngleRange = { min: 150, max: 180 };
export const ELBOW_FLEXION_TARGET: AngleRange = { min: 40, max: 85 };

// ---- Shoulder abduction (lateral raise) -----------------------------------
export const SHOULDER_ABDUCTION_START: AngleRange = { min: 0, max: 35 };
export const SHOULDER_ABDUCTION_TARGET: AngleRange = { min: 80, max: 110 };

// ---- Shoulder flexion (front raise) ---------------------------------------
export const SHOULDER_FLEXION_START: AngleRange = { min: 0, max: 35 };
export const SHOULDER_FLEXION_TARGET: AngleRange = { min: 80, max: 120 };

// ---- Deadlift / hip hinge --------------------------------------------------
export const DEADLIFT_SPINE_START: AngleRange = { min: 155, max: 180 };
export const DEADLIFT_SPINE_TARGET: AngleRange = { min: 80, max: 120 };

// ---- Glute bridge ----------------------------------------------------------
export const BRIDGE_HIP_START: AngleRange = { min: 90, max: 140 };
export const BRIDGE_HIP_TARGET: AngleRange = { min: 160, max: 180 };

const both = (
  left: TrackableJointName,
  right: TrackableJointName,
  range: JointRepRange,
): ExerciseAngleRanges => ({ [left]: range, [right]: range });

export const REP_ANGLE_RANGES = {
  squat: both('left_knee', 'right_knee', { start: SQUAT_KNEE_START, target: SQUAT_KNEE_TARGET }),
  lunge_right: {
    right_knee: { start: LUNGE_KNEE_START, target: LUNGE_FRONT_KNEE_TARGET },
    left_knee: { start: LUNGE_KNEE_START, target: LUNGE_BACK_KNEE_TARGET },
  },
  lunge_left: {
    left_knee: { start: LUNGE_KNEE_START, target: LUNGE_FRONT_KNEE_TARGET },
    right_knee: { start: LUNGE_KNEE_START, target: LUNGE_BACK_KNEE_TARGET },
  },
  /** Lead leg unknown: either knee may be the front one, so accept the wider back-knee band. */
  lunge: both('left_knee', 'right_knee', {
    start: LUNGE_KNEE_START,
    target: {
      min: Math.min(LUNGE_FRONT_KNEE_TARGET.min, LUNGE_BACK_KNEE_TARGET.min),
      max: Math.max(LUNGE_FRONT_KNEE_TARGET.max, LUNGE_BACK_KNEE_TARGET.max),
    },
  }),
  elbow_flexion: both('left_elbow', 'right_elbow', {
    start: ELBOW_FLEXION_START,
    target: ELBOW_FLEXION_TARGET,
  }),
  shoulder_abduction: both('left_shoulder', 'right_shoulder', {
    start: SHOULDER_ABDUCTION_START,
    target: SHOULDER_ABDUCTION_TARGET,
  }),
  shoulder_flexion: both('left_shoulder', 'right_shoulder', {
    start: SHOULDER_FLEXION_START,
    target: SHOULDER_FLEXION_TARGET,
  }),
  deadlift: { spine: { start: DEADLIFT_SPINE_START, target: DEADLIFT_SPINE_TARGET } },
  glute_bridge: both('left_hip', 'right_hip', { start: BRIDGE_HIP_START, target: BRIDGE_HIP_TARGET }),
} satisfies Record<string, ExerciseAngleRanges>;

export type RepAngleRangeKey = keyof typeof REP_ANGLE_RANGES;

/** Library exercise ids → their range set. */
export const EXERCISE_ID_RANGES: Record<string, RepAngleRangeKey> = {
  library_squat: 'squat',
  library_lunge_right: 'lunge_right',
  library_elbow_flexion: 'elbow_flexion',
  library_shoulder_abduction: 'shoulder_abduction',
  library_deadlift: 'deadlift',
};

export interface NameRangeRule {
  /** The name must match this… */
  pattern: RegExp;
  /** …and this, when set… */
  requires?: RegExp;
  /** …and must not match this. */
  exclude?: RegExp;
  key: RepAngleRangeKey;
}

const LUNGE_NAME = /\blunges?\b|\bsplit squats?\b/i;
/** Names that train both legs in turn: the lead leg changes, so no one-sided window applies. */
const BOTH_SIDES = /\balternat|\bboth\b|\beach\b|\bleft\b.*\bright\b|\bright\b.*\bleft\b/i;

/** Generated (plan) exercises are matched by name; first match wins, so specific rules go first. */
export const EXERCISE_NAME_RANGES: readonly NameRangeRule[] = [
  { pattern: LUNGE_NAME, requires: /\bright\b/i, exclude: BOTH_SIDES, key: 'lunge_right' },
  { pattern: LUNGE_NAME, requires: /\bleft\b/i, exclude: BOTH_SIDES, key: 'lunge_left' },
  { pattern: LUNGE_NAME, key: 'lunge' },
  { pattern: /\bsquats?\b|\bsit[- ]to[- ]stand\b/i, key: 'squat' },
  { pattern: /\bdead\s?lifts?\b|\bhip hinges?\b|\bgood mornings?\b/i, key: 'deadlift' },
  { pattern: /\b(glute |hip )?bridges?\b/i, key: 'glute_bridge' },
  {
    pattern: /\bcurls?\b|\belbow flexion\b/i,
    // Curls that move the knee, wrist or ankle are not elbow exercises.
    exclude: /\b(hamstring|leg|wrist|nordic|calf|toe|knee)\b/i,
    key: 'elbow_flexion',
  },
  { pattern: /\blateral raises?\b|\bshoulder abduction\b/i, key: 'shoulder_abduction' },
  { pattern: /\bfront raises?\b|\bshoulder flexion\b/i, key: 'shoulder_flexion' },
];

function matchesName(rule: NameRangeRule, name: string): boolean {
  return (
    rule.pattern.test(name) &&
    (!rule.requires || rule.requires.test(name)) &&
    (!rule.exclude || !rule.exclude.test(name))
  );
}

export function repAngleRangesFor(exercise: Pick<Exercise, 'id' | 'name'>): ExerciseAngleRanges | null {
  const byId = EXERCISE_ID_RANGES[exercise.id];
  if (byId) return REP_ANGLE_RANGES[byId];
  const byName = EXERCISE_NAME_RANGES.find((rule) => matchesName(rule, exercise.name));
  return byName ? REP_ANGLE_RANGES[byName.key] : null;
}

function mid(range: AngleRange): number {
  return Math.round((range.min + range.max) / 2);
}

/** Apply a joint's start/target ranges to a rule, keeping its nominal angles inside them. */
export function applyRangeToRule(rule: TrackingRule, range: JointRepRange): TrackingRule {
  const startAngle = mid(range.start);
  const requiredAngle = mid(range.target);
  return {
    ...rule,
    startAngle,
    requiredAngle,
    startRange: { ...range.start },
    targetRange: { ...range.target },
    tolerance: Math.round((range.target.max - range.target.min) / 2),
    minimumAngle: Math.min(rule.minimumAngle, range.target.min, range.start.min),
    maximumAngle: Math.max(rule.maximumAngle, range.target.max, range.start.max),
  };
}

/**
 * Attach the configured ranges to every matching tracking rule. Rules for joints with no
 * configured range keep their `requiredAngle ± tolerance` window.
 */
export function applyRepAngleRanges(exercise: Exercise): Exercise {
  if (exercise.modality === 'hand_trace') return exercise;
  const ranges = repAngleRangesFor(exercise);
  if (!ranges) return exercise;
  let changed = false;
  const trackingRules = exercise.trackingRules.map((rule) => {
    const range = ranges[rule.joint];
    if (!range) return rule;
    changed = true;
    return applyRangeToRule(rule, range);
  });
  return changed ? { ...exercise, trackingRules } : exercise;
}
