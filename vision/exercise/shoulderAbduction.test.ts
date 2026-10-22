import { describe, expect, it } from 'vitest';
import { RepDetector } from './RepDetector';
import {
  makeShoulderAbductionExercise,
  makeShoulderAbductionRule,
  simulateDirectionalJointRep,
  snapshotWithAngles,
} from './testFixtures';

describe('Shoulder Abduction rep detection', () => {
  it('counts a valid increasing-direction abduction rep', () => {
    const exercise = makeShoulderAbductionExercise('right', { recommendedReps: 3 });
    const rule = makeShoulderAbductionRule('right');
    const detector = new RepDetector(exercise, { minTimeBetweenRepsMs: 0 });

    simulateDirectionalJointRep(
      (snapshot) => detector.update(snapshot),
      'right_shoulder',
      rule,
      { holdMs: 1000 },
    );

    expect(detector.getRepCount()).toBe(1);
  });

  it('does not count a half rep that never reaches target', () => {
    const exercise = makeShoulderAbductionExercise('right');
    const rule = makeShoulderAbductionRule('right');
    const detector = new RepDetector(exercise, { minTimeBetweenRepsMs: 0 });

    detector.update(snapshotWithAngles({ right_shoulder: rule.startAngle }, 0));
    detector.update(snapshotWithAngles({ right_shoulder: 55 }, 100));
    detector.update(snapshotWithAngles({ right_shoulder: rule.startAngle }, 200));
    detector.update(snapshotWithAngles({ right_shoulder: rule.startAngle }, 800));

    expect(detector.getRepCount()).toBe(0);
  });

  it('requires priming from the start zone before counting', () => {
    const exercise = makeShoulderAbductionExercise('left');
    const rule = makeShoulderAbductionRule('left');
    const detector = new RepDetector(exercise, { minTimeBetweenRepsMs: 0 });

    detector.update(snapshotWithAngles({ left_shoulder: 60 }, 0));
    detector.update(snapshotWithAngles({ left_shoulder: rule.requiredAngle }, 100));
    detector.update(snapshotWithAngles({ left_shoulder: rule.startAngle }, 200));

    expect(detector.getRepCount()).toBe(0);
  });
});
