import { describe, expect, it } from 'vitest';
import {
  calculateJointAngles,
  JointAngleCalculator,
  TRACKABLE_JOINTS,
} from './jointAngles';
import { blankLandmarks, poseFromLandmarks, setLandmark } from '../test/fixtures';

function poseWithLeftElbowTriplet(
  shoulder: { x: number; y: number; z?: number },
  elbow: { x: number; y: number; z?: number },
  wrist: { x: number; y: number; z?: number },
  visibility = 0.95,
) {
  const landmarks = blankLandmarks(visibility);
  setLandmark(landmarks, 'rightShoulder', { x: 0.8, y: 0.3, z: 0, visibility });
  setLandmark(landmarks, 'leftShoulder', { ...shoulder, z: shoulder.z ?? 0, visibility });
  setLandmark(landmarks, 'leftElbow', { ...elbow, z: elbow.z ?? 0, visibility });
  setLandmark(landmarks, 'leftWrist', { ...wrist, z: wrist.z ?? 0, visibility });
  return poseFromLandmarks(landmarks, 1_234_567_890);
}

describe('calculateJointAngles', () => {
  it('returns all trackable joints in the snapshot', () => {
    const landmarks = blankLandmarks(0.95);
    setLandmark(landmarks, 'leftShoulder', { x: 0.2, y: 0.3, visibility: 0.95 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.8, y: 0.3, visibility: 0.95 });
    setLandmark(landmarks, 'leftHip', { x: 0.25, y: 0.6, visibility: 0.95 });
    setLandmark(landmarks, 'rightHip', { x: 0.75, y: 0.6, visibility: 0.95 });
    setLandmark(landmarks, 'nose', { x: 0.5, y: 0.1, visibility: 0.95 });

    const snapshot = calculateJointAngles(poseFromLandmarks(landmarks, 100));
    expect(Object.keys(snapshot.joints).sort()).toEqual([...TRACKABLE_JOINTS].sort());
    expect(snapshot.timestamp).toBe(100);
    expect(snapshot.coordinateSpace).toBe('image');
  });

  it('prefers world landmarks when present', () => {
    const image = blankLandmarks(0.95);
    const world = blankLandmarks(0.95);
    setLandmark(world, 'leftShoulder', { x: -1, y: 0, z: 0, visibility: 0.95 });
    setLandmark(world, 'rightShoulder', { x: 2, y: 0, z: 0, visibility: 0.95 });
    setLandmark(world, 'leftElbow', { x: 0, y: 0, z: 0, visibility: 0.95 });
    setLandmark(world, 'leftWrist', { x: 0, y: 1, z: 0, visibility: 0.95 });

    const snapshot = calculateJointAngles(poseFromLandmarks(image, 200, world));
    expect(snapshot.coordinateSpace).toBe('world');
    expect(snapshot.joints.left_elbow.available).toBe(true);
    if (snapshot.joints.left_elbow.available) {
      expect(snapshot.joints.left_elbow.angle).toBeCloseTo(90, 0);
    }
  });

  it('measures a straight elbow near 180 degrees', () => {
    const pose = poseWithLeftElbowTriplet(
      { x: 0.15, y: 0.3 },
      { x: 0.15, y: 0.45 },
      { x: 0.15, y: 0.6 },
    );
    const reading = calculateJointAngles(pose).joints.left_elbow;
    expect(reading.available).toBe(true);
    if (reading.available) {
      expect(reading.angle).toBeCloseTo(180, 0);
      expect(reading.confidence).toBeGreaterThan(0.9);
    }
  });

  it('measures a 90 degree elbow', () => {
    const pose = poseWithLeftElbowTriplet(
      { x: 0.15, y: 0.4 },
      { x: 0.15, y: 0.5 },
      { x: 0.25, y: 0.5 },
    );
    const reading = calculateJointAngles(pose).joints.left_elbow;
    expect(reading.available).toBe(true);
    if (reading.available) {
      expect(reading.angle).toBeCloseTo(90, 0);
    }
  });

  it('measures a 45 degree elbow', () => {
    const pose = poseWithLeftElbowTriplet(
      { x: 0.05, y: 0.5 },
      { x: 0.15, y: 0.5 },
      { x: 0.15 - 0.07 * Math.SQRT1_2, y: 0.5 + 0.07 * Math.SQRT1_2 },
    );
    const reading = calculateJointAngles(pose).joints.left_elbow;
    expect(reading.available).toBe(true);
    if (reading.available) {
      expect(reading.angle).toBeCloseTo(45, 0);
    }
  });

  it('marks missing landmarks as unavailable', () => {
    const landmarks = blankLandmarks(0.95).slice(0, 12);
    const reading = calculateJointAngles(poseFromLandmarks(landmarks)).joints.left_elbow;
    expect(reading.available).toBe(false);
    if (!reading.available) {
      expect(reading.reason).toBe('MISSING_LANDMARK');
    }
  });

  it('marks low-confidence landmarks as unavailable', () => {
    const pose = poseWithLeftElbowTriplet(
      { x: 0.15, y: 0.4 },
      { x: 0.15, y: 0.5 },
      { x: 0.25, y: 0.5 },
      0.1,
    );
    const reading = calculateJointAngles(pose, { minimumLandmarkVisibility: 0.5 }).joints.left_elbow;
    expect(reading.available).toBe(false);
    if (!reading.available) {
      expect(reading.reason).toBe('LOW_CONFIDENCE');
      expect(reading.confidence).toBeLessThan(0.5);
    }
  });

  it('marks zero-length vectors as invalid geometry', () => {
    const pose = poseWithLeftElbowTriplet(
      { x: 0.15, y: 0.5 },
      { x: 0.15, y: 0.5 },
      { x: 0.15, y: 0.5 },
    );
    const reading = calculateJointAngles(pose).joints.left_elbow;
    expect(reading.available).toBe(false);
    if (!reading.available) {
      expect(reading.reason).toBe('INVALID_GEOMETRY');
    }
  });

  it('rejects sudden angle jumps when previousAngles are supplied', () => {
    const pose = poseWithLeftElbowTriplet(
      { x: 0.15, y: 0.4 },
      { x: 0.15, y: 0.5 },
      { x: 0.25, y: 0.5 },
    );
    const reading = calculateJointAngles(pose, {
      previousAngles: { left_elbow: 170 },
      maxAngleJumpDeg: 10,
    }).joints.left_elbow;
    expect(reading.available).toBe(false);
    if (!reading.available) {
      expect(reading.reason).toBe('SUDDEN_JUMP');
    }
  });

  it('flags left/right landmark confusion', () => {
    const landmarks = blankLandmarks(0.95);
    setLandmark(landmarks, 'leftShoulder', { x: 0.2, y: 0.3, visibility: 0.95 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.8, y: 0.3, visibility: 0.95 });
    setLandmark(landmarks, 'leftElbow', { x: 0.75, y: 0.45, visibility: 0.95 });
    setLandmark(landmarks, 'leftWrist', { x: 0.78, y: 0.6, visibility: 0.95 });

    const reading = calculateJointAngles(poseFromLandmarks(landmarks)).joints.left_elbow;
    expect(reading.available).toBe(false);
    if (!reading.available) {
      expect(reading.reason).toBe('LANDMARK_CONFUSION');
    }
  });
});

describe('JointAngleCalculator', () => {
  it('tracks previous angles across frames for jump detection', () => {
    const calculator = new JointAngleCalculator();
    const extended = poseWithLeftElbowTriplet(
      { x: 0.15, y: 0.3 },
      { x: 0.15, y: 0.45 },
      { x: 0.15, y: 0.6 },
    );
    const flexed = poseWithLeftElbowTriplet(
      { x: 0.15, y: 0.4 },
      { x: 0.15, y: 0.5 },
      { x: 0.25, y: 0.5 },
    );

    const first = calculator.calculate(extended, { maxAngleJumpDeg: 45 });
    expect(first.joints.left_elbow.available).toBe(true);

    const second = calculator.calculate(flexed, { maxAngleJumpDeg: 45 });
    expect(second.joints.left_elbow.available).toBe(false);
    if (!second.joints.left_elbow.available) {
      expect(second.joints.left_elbow.reason).toBe('SUDDEN_JUMP');
    }
  });
});
