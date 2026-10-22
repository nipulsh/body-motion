import { describe, expect, it } from 'vitest';
import { canStartPosePreviewLoop } from './posePreviewGate';

describe('canStartPosePreviewLoop', () => {
  it('allows a preview loop only when scan and exercise are idle', () => {
    expect(canStartPosePreviewLoop(false, 'idle')).toBe(true);
    expect(canStartPosePreviewLoop(false, 'completed')).toBe(true);
    expect(canStartPosePreviewLoop(false, 'cancelled')).toBe(true);
    expect(canStartPosePreviewLoop(false, 'error')).toBe(true);
  });

  it('refuses a second loop while exercise or scan is using the pose detector', () => {
    expect(canStartPosePreviewLoop(true, 'idle')).toBe(false);
    expect(canStartPosePreviewLoop(false, 'scanning')).toBe(false);
    expect(canStartPosePreviewLoop(false, 'preparing')).toBe(false);
    expect(canStartPosePreviewLoop(false, 'ready')).toBe(false);
    expect(canStartPosePreviewLoop(false, 'paused')).toBe(false);
  });
});
