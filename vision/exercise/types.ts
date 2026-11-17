import type { TrackableJointName } from '../types';

/** Mirrors server `exercise.schema.ts` — keep in sync for API responses. */
export type MovementDirection =
  | 'flexion'
  | 'extension'
  | 'abduction'
  | 'adduction'
  | 'internal_rotation'
  | 'external_rotation'
  | 'elevation'
  | 'depression';

export interface TrackingRule {
  joint: TrackableJointName;
  startAngle: number;
  requiredAngle: number;
  minimumAngle: number;
  maximumAngle: number;
  tolerance: number;
  movement: MovementDirection;
  startingPosition: string;
  targetPosition: string;
  holdDurationSeconds?: number;
  /**
   * Explicit window the joint must reach for the rep to count (client-only, from
   * `repAngleRanges.ts`). Without it the window is `requiredAngle ± tolerance`.
   */
  targetRange?: { min: number; max: number };
  /** Explicit resting window that arms and completes a rep (client-only). */
  startRange?: { min: number; max: number };
}

export type ExerciseModality = 'reps' | 'hand_trace';

/** Whole-body form analysis run alongside rep counting. */
export type ExerciseFormCheck = 'squat' | 'lunge' | 'deadlift' | 'shoulder';

export interface Exercise {
  id: string;
  name: string;
  description: string;
  /** `hand_trace` disables rep counting (e.g. fingertip tracing). Defaults to `reps`. */
  modality?: ExerciseModality;
  /** Client-only: adds knee-line and alignment checks with spoken corrections. */
  formCheck?: ExerciseFormCheck;
  /**
   * Client-only: the squat or lunge model picked before the session (`angleRangeModels.ts` ids,
   * e.g. `knee_bias`). Its ranges then judge each rep, and only correct or borderline reps count.
   */
  rangeModel?: string;
  targetBodyParts: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sets: number;
  recommendedReps: number;
  restSeconds: number;
  instructions: string[];
  safetyNotes: string[];
  trackingRules: TrackingRule[];
  /** Reserved for future AI demo videos. */
  demoVideoUrl?: string | null;
}

export type RepPhase =
  | 'READY'
  | 'MOVING_TO_TARGET'
  | 'TARGET_REACHED'
  | 'HOLDING'
  | 'RETURNING'
  | 'REP_COMPLETED';

export interface RuleStatus {
  currentAngle?: number;
  targetAngle: number;
  startAngle: number;
  satisfied: boolean;
  available: boolean;
  reason?: string;
  confidence?: number;
}

export interface RepDetectionResult {
  exerciseId: string;
  repCount: number;
  targetReps: number;
  phase: RepPhase;
  valid: boolean;
  progress: number;
  feedback: string;
  rules: Record<string, RuleStatus>;
  completed: boolean;
}
