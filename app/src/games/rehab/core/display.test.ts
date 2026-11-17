import { describe, expect, it } from 'vitest';
import type { BasePose } from '@vision/games/rehab/core/types';
import { DisplayMapper } from './display';

function mapper(alignment = { offsetX: 0, offsetY: 0, scale: 1 }) {
  const d = new DisplayMapper();
  d.resize(1080, 1920);
  d.aspect = 16 / 9;
  d.legLength = 0.4;
  d.alignment = alignment;
  return d;
}

const centre = { x: 16 / 9 / 2, y: 0.5 };

describe('display mapping', () => {
  it('puts the picture centre at the screen centre', () => {
    expect(mapper().toScreen(centre)).toEqual({ x: 540, y: 960 });
  });

  it("mirrors x: the patient's left (larger camera x) shows on the screen's left, like the reflection", () => {
    const d = mapper();
    const patientsLeft = d.toScreen({ x: centre.x + 0.1, y: 0.5 });
    const patientsRight = d.toScreen({ x: centre.x - 0.1, y: 0.5 });
    expect(patientsLeft.x).toBeLessThan(540);
    expect(patientsRight.x).toBeGreaterThan(540);
    expect(540 - patientsLeft.x).toBeCloseTo(0.1 * 1920, 6);
  });

  it('keeps y the right way up', () => {
    expect(mapper().toScreen({ x: centre.x, y: 0.6 }).y).toBeCloseTo(960 + 0.1 * 1920, 6);
  });

  it('applies the saved offset (fractions of the screen height) and scale', () => {
    const d = mapper({ offsetX: 0.05, offsetY: -0.02, scale: 1.2 });
    const s = d.toScreen({ x: centre.x + 0.1, y: 0.6 });
    expect(s.x).toBeCloseTo(540 + 0.05 * 1920 - 0.1 * 1920 * 1.2, 6);
    expect(s.y).toBeCloseTo(960 - 0.02 * 1920 + 0.1 * 1920 * 1.2, 6);
  });

  it('one world unit is one leg length, on the z = 0 plane, with y up', () => {
    const d = mapper({ offsetX: 0.03, offsetY: 0.01, scale: 0.9 });
    const hip = d.toWorld({ x: centre.x, y: 0.45 });
    const ankle = d.toWorld({ x: centre.x, y: 0.85 });
    expect(hip.y - ankle.y).toBeCloseTo(1, 6);
    expect(hip.z).toBe(0);
    expect(d.len(0.2)).toBeCloseTo(0.5, 9);
  });

  it('floorY is the world height of the base floor line under each foot', () => {
    const d = mapper();
    const base = { ankleX: { left: centre.x + 0.06, right: centre.x - 0.06 }, floorY: { left: 0.88, right: 0.87 } } as unknown as BasePose;
    expect(d.floorY(base, 'left')).toBeCloseTo(d.toWorld({ x: base.ankleX.left, y: 0.88 }).y, 9);
    expect(d.floorY(base, 'left')).toBeLessThan(d.floorY(base, 'right'));
  });

  it('places the camera so the z = 0 plane exactly fills the screen height', () => {
    const d = mapper();
    const fov = 35;
    const dist = d.cameraDistance(fov);
    expect(2 * dist * Math.tan((fov * Math.PI) / 360)).toBeCloseTo(d.visibleWorldHeight, 9);
  });

  it('fits a vertical image across a vertical stage', () => {
    const d = new DisplayMapper();
    d.resize(1080, 1920);
    d.aspect = 9 / 16;
    const screenLeft = d.toScreen({ x: 9 / 16, y: 0.5 });
    const screenRight = d.toScreen({ x: 0, y: 0.5 });
    expect(screenLeft.x).toBeCloseTo(0, 6);
    expect(screenRight.x).toBeCloseTo(1080, 6);
    expect(d.toScreen({ x: 9 / 32, y: 0.5 }).x).toBeCloseTo(540, 6);
  });
});

describe('visible part of the picture', () => {
  it('reports the image area the portrait screen shows: full height, a centred slice of the width', () => {
    const b = mapper().visibleImageBounds();
    expect(b.minX).toBeCloseTo(16 / 9 / 2 - 540 / 1920, 9);
    expect(b.maxX).toBeCloseTo(16 / 9 / 2 + 540 / 1920, 9);
    expect(b.minY).toBeCloseTo(0, 9);
    expect(b.maxY).toBeCloseTo(1, 9);
  });

  it('follows the saved alignment: its corners land on the screen corners', () => {
    const d = mapper({ offsetX: 0.05, offsetY: -0.02, scale: 1.2 });
    const b = d.visibleImageBounds();
    // Mirrored: the largest image x is the screen's left edge.
    const topLeft = d.toScreen({ x: b.maxX, y: b.minY });
    const bottomRight = d.toScreen({ x: b.minX, y: b.maxY });
    expect(topLeft.x).toBeCloseTo(0, 6);
    expect(topLeft.y).toBeCloseTo(0, 6);
    expect(bottomRight.x).toBeCloseTo(1080, 6);
    expect(bottomRight.y).toBeCloseTo(1920, 6);
  });

  it('a landscape screen shows the whole 16:9 picture', () => {
    const d = mapper();
    d.resize(1920, 1080);
    const b = d.visibleImageBounds();
    expect(b.minX).toBeCloseTo(0, 9);
    expect(b.maxX).toBeCloseTo(16 / 9, 9);
  });
});
