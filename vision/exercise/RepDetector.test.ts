import { describe, expect, it } from 'vitest';
import { RepDetector } from './RepDetector';
import {
  angleReading,
  makeExercise,
  makeTrackingRule,
  simulateSingleJointRep,
  snapshotWithAngles,
  unavailableReading,
} from './testFixtures';
import { targetRange } from './ruleEvaluation';
import { ExerciseTracker } from './ExerciseTracker';
import { blankLandmarks, poseFromLandmarks } from '../test/fixtures';

describe('RepDetector', () => {
  it('does not count reps for hand_trace modality', () => {
    const detector = new RepDetector(
      makeExercise({ id: 'trace', modality: 'hand_trace', trackingRules: [], recommendedReps: 10 }),
      { minTimeBetweenRepsMs: 0 },
    );
    const result = detector.update(snapshotWithAngles({ left_elbow: 90 }, 0));
    expect(result.repCount).toBe(0);
    expect(result.feedback).toContain('fingertip');
  });

  it('counts a correct complete rep', () => {
    const rule = makeTrackingRule({ joint: 'left_elbow', startAngle: 170, requiredAngle: 90, tolerance: 10 });
    const exercise = makeExercise({ id: 'elbow_flex', trackingRules: [rule], recommendedReps: 3 });
    const detector = new RepDetector(exercise, { minTimeBetweenRepsMs: 0 });

    simulateSingleJointRep((snapshot) => detector.update(snapshot), 'left_elbow', rule, { startAt: 1000 });

    expect(detector.getRepCount()).toBe(1);
  });

  it('does not count an incomplete movement that never reaches target', () => {
    const rule = makeTrackingRule({ joint: 'left_elbow' });
    const detector = new RepDetector(makeExercise({ id: 'partial' }), { minTimeBetweenRepsMs: 0 });

    detector.update(snapshotWithAngles({ left_elbow: 170 }, 0));
    detector.update(snapshotWithAngles({ left_elbow: 140 }, 100));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 200));

    expect(detector.getRepCount()).toBe(0);
  });

  it('does not count when target is reached but user does not return', () => {
    const rule = makeTrackingRule({ joint: 'left_elbow' });
    const detector = new RepDetector(makeExercise({ id: 'no_return' }), { minTimeBetweenRepsMs: 0 });

    detector.update(snapshotWithAngles({ left_elbow: 170 }, 0));
    detector.update(snapshotWithAngles({ left_elbow: 120 }, 100));
    detector.update(snapshotWithAngles({ left_elbow: 90 }, 200));
    detector.update(snapshotWithAngles({ left_elbow: 90 }, 300));

    expect(detector.getRepCount()).toBe(0);
  });

  it('requires all joints in a multi-joint exercise', () => {
    const exercise = makeExercise({
      id: 'squat_like',
      trackingRules: [
        makeTrackingRule({ joint: 'left_knee', startAngle: 170, requiredAngle: 90, tolerance: 10 }),
        makeTrackingRule({ joint: 'right_knee', startAngle: 170, requiredAngle: 90, tolerance: 10 }),
      ],
    });
    const detector = new RepDetector(exercise, { minTimeBetweenRepsMs: 0 });

    detector.update(snapshotWithAngles({ left_knee: 170, right_knee: 170 }, 0));
    detector.update(snapshotWithAngles({ left_knee: 90, right_knee: 170 }, 100));
    detector.update(snapshotWithAngles({ left_knee: 170, right_knee: 170 }, 200));

    expect(detector.getRepCount()).toBe(0);

    detector.reset();
    detector.update(snapshotWithAngles({ left_knee: 170, right_knee: 170 }, 1000));
    detector.update(snapshotWithAngles({ left_knee: 120, right_knee: 120 }, 1100));
    detector.update(snapshotWithAngles({ left_knee: 90, right_knee: 90 }, 1200));
    detector.update(snapshotWithAngles({ left_knee: 120, right_knee: 120 }, 1300));
    detector.update(snapshotWithAngles({ left_knee: 170, right_knee: 170 }, 1400));
    detector.update(snapshotWithAngles({ left_knee: 170, right_knee: 170 }, 2000));

    expect(detector.getRepCount()).toBe(1);
  });

  it('enforces hold duration before returning phase', () => {
    const rule = makeTrackingRule({
      joint: 'left_elbow',
      holdDurationSeconds: 1,
    });
    const detector = new RepDetector(
      makeExercise({ id: 'hold', trackingRules: [rule] }),
      { minTimeBetweenRepsMs: 0, holdGraceMs: 0 },
    );

    detector.update(snapshotWithAngles({ left_elbow: 170 }, 0));
    detector.update(snapshotWithAngles({ left_elbow: 120 }, 100));
    detector.update(snapshotWithAngles({ left_elbow: 90 }, 200));
    expect(detector.update(snapshotWithAngles({ left_elbow: 90 }, 700)).phase).toBe('HOLDING');

    detector.update(snapshotWithAngles({ left_elbow: 120 }, 800));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 900));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 1500));
    expect(detector.getRepCount()).toBe(0);

    detector.reset();
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 2000));
    detector.update(snapshotWithAngles({ left_elbow: 120 }, 2100));
    detector.update(snapshotWithAngles({ left_elbow: 90 }, 2200));
    detector.update(snapshotWithAngles({ left_elbow: 90 }, 3300));
    detector.update(snapshotWithAngles({ left_elbow: 130 }, 3400));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 3500));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 4100));

    expect(detector.getRepCount()).toBe(1);
  });

  it('accepts angles within tolerance', () => {
    const rule = makeTrackingRule({ joint: 'left_elbow', requiredAngle: 90, tolerance: 10 });
    const range = targetRange(rule);
    expect(range.min).toBe(80);
    expect(range.max).toBe(100);

    const detector = new RepDetector(makeExercise({ id: 'tol' }), { minTimeBetweenRepsMs: 0 });
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 0));
    detector.update(snapshotWithAngles({ left_elbow: 120 }, 100));
    detector.update(snapshotWithAngles({ left_elbow: 99 }, 200));
    detector.update(snapshotWithAngles({ left_elbow: 130 }, 300));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 400));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 1000));

    expect(detector.getRepCount()).toBe(1);
  });

  it('blocks counting when landmarks are missing', () => {
    const detector = new RepDetector(makeExercise({ id: 'missing' }), { minTimeBetweenRepsMs: 0 });
    const result = detector.update(snapshotWithAngles({ left_elbow: unavailableReading() }));
    expect(result.valid).toBe(false);
    expect(result.rules.left_elbow?.available).toBe(false);
    expect(detector.getRepCount()).toBe(0);
  });

  it('blocks counting when confidence is low', () => {
    const detector = new RepDetector(makeExercise({ id: 'low_conf' }), { minTimeBetweenRepsMs: 0 });
    const result = detector.update(
      snapshotWithAngles({
        left_elbow: { available: false, reason: 'LOW_CONFIDENCE', confidence: 0.2 },
      }),
    );
    expect(result.valid).toBe(false);
    expect(detector.getRepCount()).toBe(0);
  });

  it('blocks counting when angle reading reports sudden jump', () => {
    const detector = new RepDetector(makeExercise({ id: 'jump' }), { minTimeBetweenRepsMs: 0 });
    const result = detector.update(
      snapshotWithAngles({
        left_elbow: { available: false, reason: 'SUDDEN_JUMP', confidence: 0.9 },
      }),
    );
    expect(result.valid).toBe(false);
    expect(detector.getRepCount()).toBe(0);
  });

  it('prevents duplicate rep counting from one movement', () => {
    const rule = makeTrackingRule({ joint: 'left_elbow' });
    const detector = new RepDetector(makeExercise({ id: 'dup' }), { minTimeBetweenRepsMs: 0 });

    simulateSingleJointRep((snapshot) => detector.update(snapshot), 'left_elbow', rule, { startAt: 0 });
    expect(detector.getRepCount()).toBe(1);

    detector.update(snapshotWithAngles({ left_elbow: 90 }, 550));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 650));
    expect(detector.getRepCount()).toBe(1);

    const ruleWithCooldown = makeTrackingRule({ joint: 'left_elbow' });
    const cooldownDetector = new RepDetector(makeExercise({ id: 'dup_cooldown' }), {
      minTimeBetweenRepsMs: 500,
    });
    simulateSingleJointRep(
      (snapshot) => cooldownDetector.update(snapshot),
      'left_elbow',
      ruleWithCooldown,
      { startAt: 0 },
    );
    expect(cooldownDetector.getRepCount()).toBe(0);
  });

  it('requires starting from the configured start position', () => {
    const detector = new RepDetector(makeExercise({ id: 'bad_start' }), { minTimeBetweenRepsMs: 0 });

    const initial = detector.update(snapshotWithAngles({ left_elbow: 120 }, 0));
    expect(detector.getRepCount()).toBe(0);
    expect(initial.feedback).toContain('Return to starting position');

    detector.update(snapshotWithAngles({ left_elbow: 90 }, 100));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 200));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 800));

    expect(detector.getRepCount()).toBe(0);
  });

  it('resets cleanly after completion', () => {
    const exercise = makeExercise({ id: 'done', recommendedReps: 1 });
    const detector = new RepDetector(exercise, { minTimeBetweenRepsMs: 0 });
    const rule = exercise.trackingRules[0]!;

    simulateSingleJointRep((snapshot) => detector.update(snapshot), 'left_elbow', rule);
    expect(detector.getRepCount()).toBe(1);

    detector.markCompleted();
    const completed = detector.update(snapshotWithAngles({ left_elbow: 170 }, 5000));
    expect(completed.completed).toBe(true);
    expect(completed.feedback).toBe('Exercise complete');

    detector.reset();
    expect(detector.getRepCount()).toBe(0);
    expect(detector.update(snapshotWithAngles({ left_elbow: 170 }, 6000)).completed).toBe(false);
  });
});

describe('ExerciseTracker', () => {
  it('connects MotionTracker.update to rep detection during exercise mode', () => {
    const tracker = new ExerciseTracker();
    const exercise = makeExercise({ id: 'integrated', recommendedReps: 2 });
    tracker.startExercise(exercise);

    const pose = poseFromLandmarks(blankLandmarks(0.95), 0);
    expect(tracker.update(pose)).not.toBeNull();
    expect(tracker.getMotionTracker().isExerciseMode()).toBe(true);

    tracker.stopExercise();
    expect(tracker.update(pose)).toBeNull();
  });
});

describe('ruleEvaluation', () => {
  it('marks target satisfied inside tolerance band', () => {
    const rule = makeTrackingRule({ requiredAngle: 90, tolerance: 10 });
    const detector = new RepDetector(makeExercise({ id: 'rule_status' }));
    const result = detector.update(snapshotWithAngles({ left_elbow: 88 }, 0));
    expect(result.rules.left_elbow?.satisfied).toBe(true);
    expect(result.rules.left_elbow?.targetAngle).toBe(rule.requiredAngle);
  });
});
