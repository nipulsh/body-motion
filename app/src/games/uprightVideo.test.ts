import { describe, expect, it } from 'vitest';
import { uprightVideoStyle } from './uprightVideo';

describe('uprightVideoStyle', () => {
  it('turns the raw camera video by the same turn the pose gets, centred in the stage', () => {
    const style = uprightVideoStyle(270, 9 / 16, false);
    expect(style.position).toBe('absolute');
    expect(style.left).toBe('50%');
    expect(style.top).toBe('50%');
    expect(style.transform).toBe('translate(-50%, -50%) rotate(270deg)');
  });

  it('fills the stage height: the raw width becomes the upright height on a quarter turn', () => {
    const style = uprightVideoStyle(90, 9 / 16, false);
    // The element holds the raw (landscape) picture; turned, its width runs down the stage.
    expect(style.width).toBe('100cqh');
    expect(style.height).toBe('calc(100cqh * 0.5625)');
    expect(style.objectFit).toBe('fill');
  });

  it('fills the stage height without a turn too', () => {
    const style = uprightVideoStyle(0, 3 / 4, false);
    expect(style.width).toBe('calc(100cqh * 0.75)');
    expect(style.height).toBe('100cqh');
    expect(style.transform).toBe('translate(-50%, -50%) rotate(0deg)');
  });

  it('mirrors after turning, so the patient sees a reflection, not the camera view', () => {
    expect(uprightVideoStyle(270, 9 / 16, true).transform).toBe('translate(-50%, -50%) scaleX(-1) rotate(270deg)');
  });

  it('assumes a 9:16 upright picture until the camera reports', () => {
    for (const aspect of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(uprightVideoStyle(270, aspect, false).height).toBe('calc(100cqh * 0.5625)');
    }
  });
});
