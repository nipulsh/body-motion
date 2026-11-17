import { describe, expect, it } from 'vitest';
import * as orientation from './gameVideoOrientation';
import { gameCalculationsReady, orientationFromFrame } from './gameVideoOrientation';

describe('game video orientation', () => {
  it('treats a taller frame as vertical and a wider or square frame as horizontal', () => {
    expect(orientationFromFrame(1080, 1920)).toBe('vertical');
    expect(orientationFromFrame(1920, 1080)).toBe('horizontal');
    expect(orientationFromFrame(100, 100)).toBe('horizontal');
  });

  it('stays unknown until the camera reports a real size', () => {
    expect(orientationFromFrame(0, 1080)).toBe('unknown');
    expect(orientationFromFrame(1920, 0)).toBe('unknown');
    expect(orientationFromFrame(-1, 10)).toBe('unknown');
  });

  it('no longer decides whether the kiosk rotates: every page is portrait', () => {
    expect('kioskShouldRotate' in orientation).toBe(false);
  });

  it('runs game math once a frame has arrived and the portrait stage is on screen', () => {
    expect(gameCalculationsReady('vertical', true)).toBe(true);
    // An upright landscape camera still plays on the portrait stage.
    expect(gameCalculationsReady('horizontal', true)).toBe(true);
  });

  it('waits for the first frame and for the stage rotation', () => {
    expect(gameCalculationsReady('unknown', true)).toBe(false);
    expect(gameCalculationsReady('vertical', null)).toBe(false);
    expect(gameCalculationsReady('vertical', false)).toBe(false);
    expect(gameCalculationsReady('horizontal', false)).toBe(false);
  });
});
