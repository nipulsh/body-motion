import { describe, expect, it } from 'vitest';
import { OrientationEstimator, directionFromYaw } from './OrientationEstimator';
import { PoseProcessor } from '../pose/PoseProcessor';
import { poseForYaw, poseFromLandmarks, visibleStandingLandmarks } from '../test/fixtures';
import type { FacingDirection } from '../types';

const SECTORS: { yaw: number; direction: FacingDirection; faceVisible: boolean }[] = [
  { yaw: 0, direction: 'front', faceVisible: true },
  { yaw: 45, direction: 'front_right', faceVisible: true },
  { yaw: 90, direction: 'right', faceVisible: true },
  { yaw: 135, direction: 'back_right', faceVisible: true },
  { yaw: 180, direction: 'back', faceVisible: false },
  { yaw: 225, direction: 'back_left', faceVisible: true },
  { yaw: 270, direction: 'left', faceVisible: true },
  { yaw: 315, direction: 'front_left', faceVisible: true },
];

function settle(estimator: OrientationEstimator, yaw: number, faceVisible: boolean) {
  const processor = new PoseProcessor();
  let result = estimator.update(poseForYaw(yaw, { faceVisible }), processor.process(poseForYaw(yaw, { faceVisible })));
  for (let i = 0; i < 24; i += 1) {
    const pose = poseForYaw(yaw, { faceVisible, timestamp: i });
    result = estimator.update(pose, processor.process(pose));
  }
  return result;
}

describe('OrientationEstimator', () => {
  it('maps eight facing sectors', () => {
    for (const sector of SECTORS) {
      const estimator = new OrientationEstimator();
      const result = settle(estimator, sector.yaw, sector.faceVisible);
      expect(result.direction, `yaw ${sector.yaw}`).toBe(sector.direction);
      expect(result.confidence).toBeGreaterThan(0.5);
    }
  });

  it('smooths sudden yaw jumps', () => {
    const estimator = new OrientationEstimator();
    const processor = new PoseProcessor();
    const start = poseForYaw(0, { faceVisible: true, timestamp: 0 });
    estimator.update(start, processor.process(start));
    const jumped = poseForYaw(90, { faceVisible: true, timestamp: 1 });
    const once = estimator.update(jumped, processor.process(jumped));
    expect(once.yawDeg).toBeLessThan(80);
    expect(once.yawDeg).toBeGreaterThan(0);
  });

  it('uses hysteresis so the 8-way label does not flicker at a boundary', () => {
    const estimator = new OrientationEstimator();
    settle(estimator, 20, true);
    const processor = new PoseProcessor();
    const near = poseForYaw(24, { faceVisible: true, timestamp: 50 });
    const held = estimator.update(near, processor.process(near));
    expect(held.direction).toBe('front');
  });

  it('returns low confidence when torso landmarks are missing', () => {
    const estimator = new OrientationEstimator();
    const processor = new PoseProcessor();
    const landmarks = visibleStandingLandmarks();
    landmarks[11] = { x: 0, y: 0, z: 0, visibility: 0 };
    landmarks[12] = { x: 0, y: 0, z: 0, visibility: 0 };
    landmarks[23] = { x: 0, y: 0, z: 0, visibility: 0 };
    landmarks[24] = { x: 0, y: 0, z: 0, visibility: 0 };
    const pose = poseFromLandmarks(landmarks);
    pose.worldLandmarks = landmarks;
    const result = estimator.update(pose, processor.process(pose));
    expect(result.confidence).toBe(0);
  });

  it('classifies yaw into eight named directions', () => {
    expect(directionFromYaw(0)).toBe('front');
    expect(directionFromYaw(90)).toBe('right');
    expect(directionFromYaw(180)).toBe('back');
    expect(directionFromYaw(270)).toBe('left');
    expect(directionFromYaw(-90)).toBe('left');
  });

  it('returns signed yaw near 0° when facing the camera, not 180°', () => {
    const estimator = new OrientationEstimator();
    const result = settle(estimator, 0, true);
    expect(result.yawDeg).toBeGreaterThan(-25);
    expect(result.yawDeg).toBeLessThan(25);
  });

  it('treats an unmirrored webcam facing pose as 0°, not 180°', () => {
    const pose = poseForYaw(0, { faceVisible: true });
    const left = pose.landmarks[11];
    const right = pose.landmarks[12];
    expect(left?.x ?? 0).toBeGreaterThan(right?.x ?? 1);

    const estimator = new OrientationEstimator();
    const processor = new PoseProcessor();
    const result = estimator.update(pose, processor.process(pose));
    expect(result.yawDeg).toBeGreaterThan(-25);
    expect(result.yawDeg).toBeLessThan(25);
  });

  it('keeps tracking yaw when hips are out of frame', () => {
    const estimator = new OrientationEstimator();
    const processor = new PoseProcessor();
    const facing = poseForYaw(0, { faceVisible: true, hipsVisible: false, timestamp: 0 });
    estimator.update(facing, processor.process(facing));
    let result = estimator.update(facing, processor.process(facing));
    for (let i = 0; i < 16; i += 1) {
      const pose = poseForYaw(40, { faceVisible: true, hipsVisible: false, timestamp: i + 2 });
      result = estimator.update(pose, processor.process(pose));
    }
    expect(result.yawDeg).toBeGreaterThan(15);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('keeps right and back distinct instead of folding everything into 0–180°', () => {
    const right = settle(new OrientationEstimator(), 90, true);
    const back = settle(new OrientationEstimator(), 180, false);
    const left = settle(new OrientationEstimator(), 270, true);
    expect(right.yawDeg).toBeGreaterThan(60);
    expect(right.yawDeg).toBeLessThan(120);
    expect(Math.abs(back.yawDeg)).toBeGreaterThan(150);
    expect(left.yawDeg).toBeLessThan(-60);
    expect(left.yawDeg).toBeGreaterThan(-120);
  });
});
