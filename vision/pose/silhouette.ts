import type { PoseSilhouette } from '../types';

/** Largest silhouette side kept per frame; enough to place the back edge to a pixel or so. */
export const SILHOUETTE_MAX_SIDE = 640;

/**
 * Keep every n-th mask pixel so neither side exceeds `maxSide`, as 0–255.
 * The stride is the same on both axes, so silhouette pixels stay square.
 */
export function silhouetteFromMask(
  values: ArrayLike<number>,
  width: number,
  height: number,
  maxSide = SILHOUETTE_MAX_SIDE,
): PoseSilhouette | null {
  if (width <= 0 || height <= 0 || values.length < width * height) return null;
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / maxSide));
  const outWidth = Math.floor(width / stride);
  const outHeight = Math.floor(height / stride);
  if (outWidth <= 0 || outHeight <= 0) return null;
  const data = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    const row = y * stride * width;
    for (let x = 0; x < outWidth; x += 1) {
      const value = values[row + x * stride]!;
      data[y * outWidth + x] = value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255);
    }
  }
  return { width: outWidth, height: outHeight, data };
}

/** Person probability (0–1) at a silhouette pixel position, bilinear; 0 outside the frame. */
export function silhouetteAt(silhouette: PoseSilhouette, x: number, y: number): number {
  const { width, height, data } = silhouette;
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (ix: number, iy: number) =>
    ix < 0 || iy < 0 || ix >= width || iy >= height ? 0 : data[iy * width + ix]!;
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return (top * (1 - ty) + bottom * ty) / 255;
}
