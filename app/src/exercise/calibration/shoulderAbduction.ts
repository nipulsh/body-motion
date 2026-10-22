export {
  makeShoulderAbductionExercise,
  makeShoulderAbductionRule,
  simulateDirectionalJointRep,
} from '@vision/exercise/testFixtures';

export const SHOULDER_ABDUCTION_CALIBRATION_NOTES = {
  measuredJoint: 'hip–shoulder–elbow interior angle (front-facing camera)',
  expectedAtSide: '~15–25°',
  expectedAtTarget: '~85–95°',
  firstExerciseOnly: true,
} as const;
