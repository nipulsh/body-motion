import { getLandmark } from './landmarks';
import type { BoundingBox, PoseLandmark, PoseMetrics, PoseResult, Vec3 } from '../types';

function midpoint(a: PoseLandmark, b: PoseLandmark): Vec3 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function emptyMetrics(): PoseMetrics {
  const origin: Vec3 = { x: 0.5, y: 0.5, z: 0 };
  const aabb: BoundingBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return {
    bodyCenter: origin,
    torsoCenter: origin,
    shoulderMid: origin,
    hipMid: origin,
    shoulderWidth: 0,
    hipWidth: 0,
    torsoOrientationHintDeg: 0,
    aabb,
    visibilityMean: 0,
    landmarkConfidenceMean: 0,
  };
}

function computeAabb(landmarks: readonly PoseLandmark[]): BoundingBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export class PoseProcessor {
  process(pose: PoseResult): PoseMetrics {
    const landmarks = pose.landmarks;
    if (landmarks.length === 0) return emptyMetrics();

    let visSum = 0;
    for (const lm of landmarks) visSum += lm.visibility;
    const visibilityMean = visSum / landmarks.length;

    const leftShoulder = getLandmark(landmarks, 'leftShoulder');
    const rightShoulder = getLandmark(landmarks, 'rightShoulder');
    const leftHip = getLandmark(landmarks, 'leftHip');
    const rightHip = getLandmark(landmarks, 'rightHip');

    const shoulderMid =
      leftShoulder && rightShoulder ? midpoint(leftShoulder, rightShoulder) : { x: 0.5, y: 0.4, z: 0 };
    const hipMid = leftHip && rightHip ? midpoint(leftHip, rightHip) : { x: 0.5, y: 0.6, z: 0 };
    const torsoCenter: Vec3 = {
      x: (shoulderMid.x + hipMid.x) / 2,
      y: (shoulderMid.y + hipMid.y) / 2,
      z: (shoulderMid.z + hipMid.z) / 2,
    };

    const aabb = computeAabb(landmarks);
    const bodyCenter: Vec3 = {
      x: (aabb.minX + aabb.maxX) / 2,
      y: (aabb.minY + aabb.maxY) / 2,
      z: torsoCenter.z,
    };

    const shoulderWidth =
      leftShoulder && rightShoulder ? distanceXZ(leftShoulder, rightShoulder) : 0;
    const hipWidth = leftHip && rightHip ? distanceXZ(leftHip, rightHip) : 0;

    const dx = shoulderMid.x - hipMid.x;
    const dy = shoulderMid.y - hipMid.y;
    const torsoOrientationHintDeg = (Math.atan2(dx, dy) * 180) / Math.PI;

    return {
      bodyCenter,
      torsoCenter,
      shoulderMid,
      hipMid,
      shoulderWidth,
      hipWidth,
      torsoOrientationHintDeg,
      aabb,
      visibilityMean,
      landmarkConfidenceMean: pose.confidence || visibilityMean,
    };
  }
}
