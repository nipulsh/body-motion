import { describe, expect, it } from 'vitest';
import { angleAtVertex } from '../math/angles';

describe('angleAtVertex', () => {
  it('returns 180 for a straight joint', () => {
    const angle = angleAtVertex({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(angle).toBeCloseTo(180, 5);
  });

  it('returns 90 for a right angle', () => {
    const angle = angleAtVertex({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(angle).toBeCloseTo(90, 5);
  });

  it('returns 45 for an acute angle', () => {
    const angle = angleAtVertex(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 },
    );
    expect(angle).toBeCloseTo(45, 5);
  });

  it('returns NaN for zero-length vectors', () => {
    const angle = angleAtVertex({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(Number.isNaN(angle)).toBe(true);
  });

  it('returns NaN for invalid coordinates', () => {
    const angle = angleAtVertex(
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    expect(Number.isNaN(angle)).toBe(true);
  });
});
