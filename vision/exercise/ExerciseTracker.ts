import type { JointAnglesSnapshot, PoseResult } from '../types';
import { MotionTracker } from '../motion/MotionTracker';
import type { Exercise, RepDetectionResult } from './types';

export type { RepDetectionResult, RepPhase, RuleStatus } from './types';
export type { Exercise, TrackingRule } from './types';

/**
 * Exercise-mode facade: pose → joint angles → rep detection.
 * Intended for the future exercise screen:
 *   const result = tracker.update(pose);
 */
export class ExerciseTracker {
  private readonly motionTracker: MotionTracker;
  private activeExercise: Exercise | null = null;

  constructor(motionTracker?: MotionTracker) {
    this.motionTracker = motionTracker ?? new MotionTracker();
  }

  getMotionTracker(): MotionTracker {
    return this.motionTracker;
  }

  startExercise(exercise: Exercise): void {
    this.activeExercise = exercise;
    this.motionTracker.startExercise(exercise);
  }

  stopExercise(): void {
    this.activeExercise = null;
    this.motionTracker.stopExercise();
  }

  isActive(): boolean {
    return this.activeExercise !== null && this.motionTracker.isExerciseMode();
  }

  getExercise(): Exercise | null {
    return this.activeExercise;
  }

  update(pose: PoseResult): RepDetectionResult | null {
    if (!this.isActive()) return null;
    return this.motionTracker.update(pose);
  }

  updateFromAngles(snapshot: JointAnglesSnapshot): RepDetectionResult | null {
    if (!this.isActive()) return null;
    return this.motionTracker.updateFromJointAngles(snapshot);
  }

  reset(): void {
    const exercise = this.activeExercise;
    this.motionTracker.reset();
    if (exercise) this.motionTracker.startExercise(exercise);
  }

  markCompleted(): void {
    this.motionTracker.markExerciseCompleted();
  }
}

export { RepDetector } from './RepDetector';
