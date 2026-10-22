import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getVisionManager } from '@vision';

describe('useExercise camera cleanup', () => {
  beforeEach(() => {
    const manager = getVisionManager();
    manager.stopExerciseSession();
    manager.stopCamera();
  });

  it('stops exercise session through VisionManager', () => {
    const manager = getVisionManager();
    manager.stopExerciseSession();
    expect(manager.isExerciseSessionActive()).toBe(false);
  });

  it('supports pausing exercise tracking without stopping the session controller', () => {
    const manager = getVisionManager();
    manager.setExerciseTrackingEnabled(false);
    expect(manager.isExerciseTrackingEnabled()).toBe(false);
    manager.setExerciseTrackingEnabled(true);
    expect(manager.isExerciseTrackingEnabled()).toBe(true);
  });

  it('allows subscribing and unsubscribing from exercise frames', () => {
    const manager = getVisionManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribeExerciseFrame(listener);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
