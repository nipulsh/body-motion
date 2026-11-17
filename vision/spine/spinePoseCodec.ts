import type { VISION_CONFIG } from '../config';
import { landmarkSeen } from '../pose/landmarks';
import type { PoseLandmark, PoseSpinePoint } from '../types';
import type { SpineKeypoints } from './spineTrack';

type SpinePoseConfig = typeof VISION_CONFIG.spinePose;

/** Region of the camera frame, in frame pixels, at the model's aspect ratio. May run past the frame edge. */
export interface SpineCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The crop the model expects, from the body MediaPipe is already tracking, so no second person
 * detector has to run. Same steps as the repo's `bbox_xyxy2cs` and `top_down_affine`: pad the box,
 * then widen one side to the model's aspect ratio around the same center.
 */
export function spineCropFromLandmarks(
  landmarks: readonly PoseLandmark[],
  frameWidth: number,
  frameHeight: number,
  config: SpinePoseConfig,
): SpineCrop | null {
  if (frameWidth <= 0 || frameHeight <= 0) return null;
  const overflow = config.maxLandmarkOverflow;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = 0;
  for (const mark of landmarks) {
    if (!landmarkSeen(mark, config.minLandmarkVisibility)) continue;
    if (!Number.isFinite(mark.x) || !Number.isFinite(mark.y)) continue;
    if (mark.x < -overflow || mark.x > 1 + overflow || mark.y < -overflow || mark.y > 1 + overflow) continue;
    const px = mark.x * frameWidth;
    const py = mark.y * frameHeight;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    seen += 1;
  }
  if (seen < config.minCropLandmarks) return null;
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  const longest = Math.max(boxWidth, boxHeight);
  if (longest < config.minBoxPx) return null;

  const padding = config.landmarkBoxPadding * longest;
  let width = (boxWidth + padding * 2) * config.cropPadding;
  let height = (boxHeight + padding * 2) * config.cropPadding;
  const aspect = config.inputWidth / config.inputHeight;
  if (width > height * aspect) height = width / aspect;
  else width = height * aspect;
  return {
    x: (minX + maxX) / 2 - width / 2,
    y: (minY + maxY) / 2 - height / 2,
    width,
    height,
  };
}

/** RGBA pixels to the model's planar float input. Alpha is dropped. */
export function rgbaToInputTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mean: readonly number[],
  std: readonly number[],
): Float32Array {
  const pixels = width * height;
  if (rgba.length !== pixels * 4) {
    throw new Error(`Expected ${pixels * 4} RGBA bytes for ${width}×${height}, got ${rgba.length}.`);
  }
  const tensor = new Float32Array(pixels * 3);
  const [meanR, meanG, meanB] = mean as [number, number, number];
  const [stdR, stdG, stdB] = std as [number, number, number];
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4;
    tensor[i] = (rgba[at]! - meanR) / stdR;
    tensor[pixels + i] = (rgba[at + 1]! - meanG) / stdG;
    tensor[pixels * 2 + i] = (rgba[at + 2]! - meanB) / stdB;
  }
  return tensor;
}

function peak(values: Float32Array, start: number, bins: number): { at: number; value: number } {
  let at = 0;
  let value = -Infinity;
  for (let i = 0; i < bins; i += 1) {
    const candidate = values[start + i]!;
    if (candidate > value) {
      value = candidate;
      at = i;
    }
  }
  return { at, value };
}

/**
 * SimCC: one 1D distribution per keypoint per axis. Takes each axis's peak, as the repo's
 * `get_simcc_maximum` does. Refining below one bin was tried on real footage and was no steadier.
 */
export function decodeSimcc(
  simccX: Float32Array,
  simccY: Float32Array,
  keypoints: number,
  xBins: number,
  yBins: number,
  splitRatio: number,
): SpineKeypoints {
  if (simccX.length !== keypoints * xBins || simccY.length !== keypoints * yBins) {
    throw new Error(`SimCC output sizes ${simccX.length} and ${simccY.length} do not match ${keypoints} keypoints.`);
  }
  const x = new Float32Array(keypoints);
  const y = new Float32Array(keypoints);
  const score = new Float32Array(keypoints);
  for (let k = 0; k < keypoints; k += 1) {
    const px = peak(simccX, k * xBins, xBins);
    const py = peak(simccY, k * yBins, yBins);
    x[k] = px.at / splitRatio;
    y[k] = py.at / splitRatio;
    score[k] = 0.5 * (px.value + py.value);
  }
  return { x, y, score };
}

/** Crop pixels back to normalized frame coordinates, in the order of the arrays. */
export function keypointsToFrame(
  keypoints: SpineKeypoints,
  crop: SpineCrop,
  frameWidth: number,
  frameHeight: number,
  inputWidth: number,
  inputHeight: number,
): PoseSpinePoint[] {
  const points: PoseSpinePoint[] = [];
  for (let i = 0; i < keypoints.x.length; i += 1) {
    points.push({
      x: (crop.x + (keypoints.x[i]! / inputWidth) * crop.width) / frameWidth,
      y: (crop.y + (keypoints.y[i]! / inputHeight) * crop.height) / frameHeight,
      score: keypoints.score[i]!,
    });
  }
  return points;
}
