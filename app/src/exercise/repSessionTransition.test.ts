import { describe, expect, it } from 'vitest';
import { VISION_CONFIG, calculateJointAngles, type TrackingRule } from '@vision';
import { RepDetector } from '@vision/exercise/RepDetector';
import { isAngleInRange, startRange, targetRange } from '@vision/exercise/ruleEvaluation';
import { makeExercise, makeTrackingRule, snapshotWithAngles } from '@vision/exercise/testFixtures';
import { blankLandmarks, poseFromLandmarks, setLandmark } from '@vision/test/fixtures';
import { coachingForCountdownStep } from './exerciseVoiceCoaching';
import {
  entryVoiceStateForCountdown,
  getNextCountdownStep,
  leaveGetInPosition,
  shouldSpeakPositioning,
} from './sessionState';

const START_TOLERANCE = 12 * VISION_CONFIG.repDetection.startToleranceFactor;

function libraryShoulderRule(): TrackingRule {
  return makeTrackingRule({
    joint: 'right_shoulder',
    movement: 'abduction',
    startAngle: 20,
    requiredAngle: 90,
    minimumAngle: 10,
    maximumAngle: 120,
    tolerance: 12,
    holdDurationSeconds: 0,
    startingPosition: 'Right arm at side',
    targetPosition: 'Right arm at shoulder height',
  });
}

function shoulderPose(elbow: { x: number; y: number }) {
  const landmarks = blankLandmarks(0.95);
  setLandmark(landmarks, 'leftShoulder', { x: 0.38, y: 0.32, visibility: 0.95 });
  setLandmark(landmarks, 'rightShoulder', { x: 0.62, y: 0.32, visibility: 0.95 });
  setLandmark(landmarks, 'leftHip', { x: 0.42, y: 0.58, visibility: 0.95 });
  setLandmark(landmarks, 'rightHip', { x: 0.58, y: 0.58, visibility: 0.95 });
  setLandmark(landmarks, 'rightElbow', { x: elbow.x, y: elbow.y, visibility: 0.95 });
  setLandmark(landmarks, 'rightWrist', { x: elbow.x, y: elbow.y + 0.14, visibility: 0.95 });
  return poseFromLandmarks(landmarks);
}

describe('rep-count angle transition', () => {
  it('counts a straight elbow that travels through the library flexion range', () => {
    const rule = makeTrackingRule({
      joint: 'right_elbow',
      movement: 'flexion',
      startAngle: 165,
      requiredAngle: 75,
      minimumAngle: 45,
      maximumAngle: 180,
      tolerance: 12,
      holdDurationSeconds: 0,
    });
    const rest = startRange(rule, START_TOLERANCE);
    const target = targetRange(rule);
    // A fully extended elbow measures ~180°, outside the old ±tolerance box around 165°.
    expect(isAngleInRange(180, rest)).toBe(true);
    expect(isAngleInRange(180, target)).toBe(false);
    expect(isAngleInRange(70, target)).toBe(true);
    expect(isAngleInRange(160, target)).toBe(false);

    const detector = new RepDetector(makeExercise({ id: 'elbow', trackingRules: [rule] }), {
      minTimeBetweenRepsMs: 0,
    });
    detector.update(snapshotWithAngles({ right_elbow: 180 }, 0));
    detector.update(snapshotWithAngles({ right_elbow: 160 }, 100));
    detector.update(snapshotWithAngles({ right_elbow: 180 }, 200));
    expect(detector.getRepCount()).toBe(0);

    detector.update(snapshotWithAngles({ right_elbow: 120 }, 300));
    detector.update(snapshotWithAngles({ right_elbow: 70 }, 400));
    detector.update(snapshotWithAngles({ right_elbow: 120 }, 500));
    detector.update(snapshotWithAngles({ right_elbow: 180 }, 600));
    expect(detector.getRepCount()).toBe(1);
  });

  it('counts shoulder abduction from a real arm-at-side pose to shoulder height', () => {
    const rule = libraryShoulderRule();
    const down = calculateJointAngles(shoulderPose({ x: 0.66, y: 0.52 })).joints.right_shoulder;
    const up = calculateJointAngles(shoulderPose({ x: 0.86, y: 0.32 })).joints.right_shoulder;
    expect(down.available).toBe(true);
    expect(up.available).toBe(true);
    if (!down.available || !up.available) return;

    const rest = startRange(rule, START_TOLERANCE);
    const target = targetRange(rule);
    expect(isAngleInRange(down.angle, rest)).toBe(true);
    expect(isAngleInRange(up.angle, target)).toBe(true);
    expect(isAngleInRange(down.angle, target)).toBe(false);

    const mid = (down.angle + up.angle) / 2;
    expect(isAngleInRange(mid, rest)).toBe(false);
    expect(isAngleInRange(mid, target)).toBe(false);

    const detector = new RepDetector(makeExercise({ id: 'shoulder', trackingRules: [rule] }), {
      minTimeBetweenRepsMs: 0,
    });
    detector.update(snapshotWithAngles({ right_shoulder: down.angle }, 0));
    detector.update(snapshotWithAngles({ right_shoulder: mid }, 100));
    detector.update(snapshotWithAngles({ right_shoulder: up.angle }, 200));
    detector.update(snapshotWithAngles({ right_shoulder: mid }, 300));
    detector.update(snapshotWithAngles({ right_shoulder: down.angle }, 400));
    expect(detector.getRepCount()).toBe(1);
  });

  it('still counts when minimum and maximum only boxed the target angle', () => {
    const rule = makeTrackingRule({
      joint: 'left_elbow',
      startAngle: 170,
      requiredAngle: 90,
      minimumAngle: 80,
      maximumAngle: 100,
      tolerance: 10,
      holdDurationSeconds: 0,
    });
    expect(isAngleInRange(170, startRange(rule, 10 * 1.15))).toBe(true);
    expect(isAngleInRange(90, targetRange(rule))).toBe(true);

    const detector = new RepDetector(makeExercise({ id: 'clipped', trackingRules: [rule] }), {
      minTimeBetweenRepsMs: 0,
    });
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 0));
    detector.update(snapshotWithAngles({ left_elbow: 130 }, 100));
    detector.update(snapshotWithAngles({ left_elbow: 90 }, 200));
    detector.update(snapshotWithAngles({ left_elbow: 130 }, 300));
    detector.update(snapshotWithAngles({ left_elbow: 170 }, 400));
    expect(detector.getRepCount()).toBe(1);
  });
});

describe('get-in-position entry', () => {
  it('leaves get-in-position into a spoken 1, 2, 3 countdown and then counting', () => {
    expect(entryVoiceStateForCountdown('ready', 'countdown')).toBe('get_in_position');
    expect(shouldSpeakPositioning('countdown', 'ready')).toBe(true);
    expect(coachingForCountdownStep('ready')?.voiceText.toLowerCase()).not.toContain('position');

    const first = leaveGetInPosition('ready');
    expect(first).toBe(1);
    expect(entryVoiceStateForCountdown(first, 'countdown')).toBe('countdown');
    expect(shouldSpeakPositioning('countdown', 1)).toBe(false);
    expect(coachingForCountdownStep(1)?.voiceText).toBe('1');
    expect(getNextCountdownStep(1)).toBe(2);
    expect(coachingForCountdownStep(2)?.voiceText).toBe('2');
    expect(getNextCountdownStep(2)).toBe(3);
    expect(coachingForCountdownStep(3)?.voiceText).toBe('3');
    expect(getNextCountdownStep(3)).toBeNull();

    expect(entryVoiceStateForCountdown(3, 'active')).toBe('counting');
    expect(shouldSpeakPositioning('active', 'ready')).toBe(false);
    expect(shouldSpeakPositioning('active', 3)).toBe(false);
  });
});
