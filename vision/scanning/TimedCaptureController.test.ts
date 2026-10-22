import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import type { CapturedFrame } from '../types';
import { TimedCaptureController } from './TimedCaptureController';

const { frameCount, frameIntervalMs, durationMs } = VISION_CONFIG.timedCapture;
const video = { readyState: 2, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

function frame(tag: string): CapturedFrame {
  return {
    blob: new Blob([tag], { type: 'image/jpeg' }),
    timestamp: Date.now(),
    width: 640,
    height: 480,
  };
}

// `now` reads the fake clock so advancing timers also advances the controller's deadline checks.
function createController(captureFrame: () => Promise<CapturedFrame | null>) {
  const events: string[] = [];
  const controller = new TimedCaptureController({
    isCameraLive: () => true,
    getVideo: () => video,
    captureFrame,
    emit: (event) => events.push(event),
    now: () => Date.now(),
  });
  return { controller, events };
}

describe('TimedCaptureController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not emit SCAN_ERROR when cancelled while the last frame encodes past the deadline', async () => {
    let attempts = 0;
    const { controller, events } = createController(async () => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, attempts === frameCount ? 300 : 10));
      return frame(`f${attempts}`);
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync((frameCount - 1) * frameIntervalMs + 50);
    controller.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(controller.getSnapshot().scanState).toBe('cancelled');
    expect(events).toContain('SCAN_CANCELLED');
    expect(events).not.toContain('SCAN_ERROR');
    expect(events).not.toContain('SCAN_COMPLETED');
  });

  it('does not store a capture from a previous session after restart', async () => {
    let attempts = 0;
    let releaseFirst = () => {};
    const { controller } = createController(async () => {
      attempts += 1;
      if (attempts === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return frame('stale');
      }
      return frame(`f${attempts}`);
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.start();
    releaseFirst();
    await vi.advanceTimersByTimeAsync(durationMs + 500);

    const images = controller.getResult()?.images ?? [];
    expect(images).toHaveLength(frameCount);
    const contents = await Promise.all(images.map((image) => image.blob.text()));
    expect(contents).not.toContain('stale');
  });

  it('retries a null encode at the same index and still completes with 80 frames', async () => {
    let attempts = 0;
    const { controller, events } = createController(async () => {
      attempts += 1;
      return attempts === 1 ? null : frame(`f${attempts}`);
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(durationMs + 500);

    expect(events).toContain('SCAN_COMPLETED');
    expect(controller.getResult()?.images.map((image) => image.angleDeg)).toEqual(
      Array.from({ length: frameCount }, (_, index) => index),
    );
  });

  it('fails when the deadline passes with fewer than 80 frames', async () => {
    const { controller, events } = createController(async () => null);

    await controller.start();
    await vi.advanceTimersByTimeAsync(durationMs + 500);

    expect(controller.getSnapshot().scanState).toBe('error');
    expect(events).toContain('SCAN_ERROR');
    expect(events).not.toContain('SCAN_COMPLETED');
    expect(controller.getLastError()?.message).toContain(String(frameCount));
    expect(controller.getSnapshot().capturedCount).toBe(0);
  });
});
