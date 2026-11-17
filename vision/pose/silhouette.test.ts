import { describe, expect, it } from 'vitest';
import { silhouetteAt, silhouetteFromMask } from './silhouette';

describe('silhouetteFromMask', () => {
  it('keeps every other pixel of a 1280×720 mask as 0–255, square pixels', () => {
    const width = 1280;
    const height = 720;
    const mask = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) mask[y * width + x] = x < 640 ? 1 : x < 700 ? 0.5 : -0.2;
    }
    const silhouette = silhouetteFromMask(mask, width, height)!;
    expect(silhouette.width).toBe(640);
    expect(silhouette.height).toBe(360);
    expect(silhouette.data[0]).toBe(255);
    expect(silhouette.data[319]).toBe(255);
    expect(silhouette.data[320]).toBe(128);
    expect(silhouette.data[400]).toBe(0);
  });

  it('keeps a small mask whole and rejects one with missing data', () => {
    expect(silhouetteFromMask(new Float32Array(4).fill(1), 2, 2)).toEqual({
      width: 2,
      height: 2,
      data: new Uint8Array([255, 255, 255, 255]),
    });
    expect(silhouetteFromMask(new Float32Array(3), 2, 2)).toBeNull();
  });
});

describe('silhouetteAt', () => {
  const silhouette = { width: 4, height: 1, data: new Uint8Array([0, 255, 255, 0]) };

  it('blends neighbouring pixels so the body edge falls between them', () => {
    expect(silhouetteAt(silhouette, 1.5, 0.5)).toBe(1);
    expect(silhouetteAt(silhouette, 1, 0.5)).toBeCloseTo(0.5);
    expect(silhouetteAt(silhouette, 3.25, 0.5)).toBeCloseTo(0.25);
  });

  it('reads outside the frame as background', () => {
    expect(silhouetteAt(silhouette, -3, 0.5)).toBe(0);
    expect(silhouetteAt(silhouette, 1.5, 9)).toBe(0);
  });
});
