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

/**
 * Normalized picture point → canvas pixels when the picture fills the canvas height and
 * is centred across it: a narrower picture leaves the sides empty, a wider one is cropped
 * at the sides (points there land outside the canvas).
 */
export function mapNormalizedToFitHeight(
  xNorm: number,
  yNorm: number,
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): CanvasPoint {
  const pictureWidth = (canvasHeight * sourceWidth) / sourceHeight;
  const left = (canvasWidth - pictureWidth) / 2;
  return { x: left + xNorm * pictureWidth, y: yNorm * canvasHeight };
}

/** How the camera picture sits on the canvas: whole picture (contain) or full height. */
export type PictureFit = 'contain' | 'height';

export function mapPoseHipToCanvas(
  pose: PoseResult | null,
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  mirrorX = true,
  fit: PictureFit = 'contain',
): CanvasPoint | null {
  const hip = hipMidpointNormalized(pose);
  if (!hip) return null;
  const xNorm = mirrorX ? 1 - hip.x : hip.x;
  if (sourceWidth > 0 && sourceHeight > 0) {
    if (fit === 'height') {
      return mapNormalizedToFitHeight(xNorm, hip.y, canvasWidth, canvasHeight, sourceWidth, sourceHeight);
    }
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
