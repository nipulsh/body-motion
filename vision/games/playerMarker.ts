import { mapNormalizedToContainCanvas } from '../pose/wireframe';
import { getLandmark } from '../pose/landmarks';
import type { PoseResult } from '../types';

export interface CanvasPoint {
  x: number;
  y: number;
}

export function hipMidpointNormalized(pose: PoseResult | null): { x: number; y: number } | null {
  if (!pose?.landmarks?.length) return null;
  const left = getLandmark(pose.landmarks, 'leftHip');
  const right = getLandmark(pose.landmarks, 'rightHip');
  if (!left || !right) return null;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

export function mapPoseHipToCanvas(
  pose: PoseResult | null,
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  mirrorX = true,
): CanvasPoint | null {
  const hip = hipMidpointNormalized(pose);
  if (!hip) return null;
  const xNorm = mirrorX ? 1 - hip.x : hip.x;
  if (sourceWidth > 0 && sourceHeight > 0) {
    return mapNormalizedToContainCanvas(
      xNorm,
      hip.y,
      canvasWidth,
      canvasHeight,
      sourceWidth,
      sourceHeight,
    );
  }
  return { x: xNorm * canvasWidth, y: hip.y * canvasHeight };
}

export function birdNearPlayer(
  birdX: number,
  birdY: number,
  player: CanvasPoint,
  radiusX = 56,
  radiusY = 72,
): boolean {
  return Math.abs(birdX - player.x) <= radiusX && Math.abs(birdY - player.y) <= radiusY;
}
