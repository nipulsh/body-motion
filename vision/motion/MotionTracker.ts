import { JointAngleCalculator } from '../pose/jointAngles';
import type { RepDetectionResult } from '../exercise/types';
import { RepDetector } from '../exercise/RepDetector';
import type { Exercise } from '../exercise/types';
import type { JointAnglesSnapshot, JointVelocity, MotionState, PoseResult, Vec3 } from '../types';

export class MotionTracker {
  private pose: PoseResult | null = null;
  private velocity: Vec3 | null = null;
  private jointMovement: JointVelocity[] = [];
  private tracking = false;
  private readonly jointAngleCalculator = new JointAngleCalculator();
  private jointAngles: JointAnglesSnapshot | null = null;
  private repDetector: RepDetector | null = null;
  private activeExercise: Exercise | null = null;
  private lastRepResult: RepDetectionResult | null = null;

  getPose(): PoseResult | null {
    return this.pose;
  }

  getVelocity(): Vec3 | null {
    return this.velocity;
  }

  getJointMovement(): JointVelocity[] {
    return this.jointMovement;
  }

  getJointAngles(): JointAnglesSnapshot | null {
    return this.jointAngles;
  }

  getActiveExercise(): Exercise | null {
    return this.activeExercise;
  }

  getLastRepResult(): RepDetectionResult | null {
    return this.lastRepResult;
  }

  isExerciseMode(): boolean {
    return this.activeExercise !== null;
  }

  startExercise(exercise: Exercise): void {
    this.activeExercise = exercise;
    this.repDetector = new RepDetector(exercise);
    this.lastRepResult = null;
    this.jointAngleCalculator.reset();
  }

  stopExercise(): void {
    this.activeExercise = null;
    this.repDetector = null;
    this.lastRepResult = null;
  }

  markExerciseCompleted(): void {
    this.repDetector?.markCompleted();
    if (this.repDetector && this.jointAngles) {
      this.lastRepResult = this.repDetector.update(this.jointAngles);
    }
  }

  getMotionState(): MotionState {
    return {
      pose: this.pose,
      velocity: this.velocity,
      jointMovement: this.jointMovement,
      tracking: this.tracking,
      jointAngles: this.jointAngles,
      exerciseActive: this.activeExercise !== null,
      repDetection: this.lastRepResult,
    };
  }

  update(pose: PoseResult): RepDetectionResult | null {
    this.pose = pose;
    this.tracking = true;
    this.jointAngles = this.jointAngleCalculator.calculate(pose);

    if (!this.repDetector || !this.jointAngles) {
      this.lastRepResult = null;
      return null;
    }

    this.lastRepResult = this.repDetector.update(this.jointAngles);
    return this.lastRepResult;
  }

  /** Updates pose/angles for preview without advancing rep detection (e.g. countdown / pause). */
  previewPose(pose: PoseResult): RepDetectionResult | null {
    this.pose = pose;
    this.tracking = true;
    this.jointAngles = this.jointAngleCalculator.calculate(pose);
    return this.lastRepResult;
  }

  updateFromJointAngles(snapshot: JointAnglesSnapshot): RepDetectionResult | null {
    if (!this.repDetector) {
      this.lastRepResult = null;
      return null;
    }
    this.tracking = true;
    this.jointAngles = snapshot;
    this.lastRepResult = this.repDetector.update(snapshot);
    return this.lastRepResult;
  }

  reset(): void {
    this.pose = null;
    this.velocity = null;
    this.jointMovement = [];
    this.tracking = false;
    this.jointAngles = null;
    this.lastRepResult = null;
    this.jointAngleCalculator.reset();
    this.repDetector?.reset();
  }

  resetMotionOnly(): void {
    this.pose = null;
    this.velocity = null;
    this.jointMovement = [];
    this.tracking = false;
    this.jointAngles = null;
    this.lastRepResult = null;
    this.jointAngleCalculator.reset();
  }
}
