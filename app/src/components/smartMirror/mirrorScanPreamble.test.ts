import { describe, expect, it } from 'vitest';
import { nextMirrorScanCountdownStep } from './mirrorScanPreamble';

describe('nextMirrorScanCountdownStep', () => {
  it('steps through 3, 2, 1 then ends', () => {
    expect(nextMirrorScanCountdownStep(3)).toBe(2);
    expect(nextMirrorScanCountdownStep(2)).toBe(1);
    expect(nextMirrorScanCountdownStep(1)).toBeNull();
  });
});
