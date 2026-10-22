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
}

export type ExerciseModality = 'reps' | 'hand_trace';

export interface Exercise {
  id: string;
  name: string;
  description: string;
  /** `hand_trace` disables rep counting (e.g. fingertip tracing). Defaults to `reps`. */
  modality?: ExerciseModality;
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
