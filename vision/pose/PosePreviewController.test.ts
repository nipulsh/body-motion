import { describe, expect, it, vi } from 'vitest';
import type { PoseResult } from '../types';
import { PosePreviewController, POSE_PREVIEW_STALE_MS } from './PosePreviewController';

function video(readyState = 2): HTMLVideoElement {
  return { readyState, videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement;
}

function pose(timestamp: number): PoseResult {
  return {
    landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 1 }],
    confidence: 1,
    timestamp,
  };
}

describe('PosePreviewController', () => {
  it('emits detector poses and clears them after they go stale', async () => {
    const frames: Array<PoseResult | null> = [];
    let now = 1_000;
    let next: PoseResult | null = pose(0);
    const queue: FrameRequestCallback[] = [];
    const detector = {
      initialize: vi.fn(async () => undefined),
      isReady: () => true,
      processFrame: vi.fn(() => next),
      dispose: () => undefined,
    };

    const controller = new PosePreviewController({
      getVideo: () => video(),
      poseDetector: detector,
      now: () => now,
      raf: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      caf: () => {
        queue.length = 0;
      },
    });

    controller.subscribe((frame) => frames.push(frame.pose));
    await controller.start();

    expect(detector.initialize).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.landmarks[0]?.x).toBe(0.5);

    next = null;
    now = 1_100;
    queue.shift()?.(now);
    expect(frames).toHaveLength(1);

    now = 1_100 + POSE_PREVIEW_STALE_MS;
    queue.shift()?.(now);
    expect(frames).toEqual([expect.any(Object), null]);
  });

  it('reports an empty mirror once the camera is live and nobody is found', async () => {
    const frames: Array<PoseResult | null> = [];
    let now = 1_000;
    const queue: FrameRequestCallback[] = [];
    const controller = new PosePreviewController({
      getVideo: () => video(),
      poseDetector: {
        initialize: async () => undefined,
        isReady: () => true,
        processFrame: () => null,
        dispose: () => undefined,
      },
      now: () => now,
      raf: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      caf: () => {
        queue.length = 0;
      },
    });

    controller.subscribe((frame) => frames.push(frame.pose));
    await controller.start();
    expect(frames).toEqual([]);

    now = 1_000 + POSE_PREVIEW_STALE_MS - 1;
    queue.shift()?.(now);
    expect(frames).toEqual([]);

    now = 1_000 + POSE_PREVIEW_STALE_MS + 100;
    queue.shift()?.(now);
    expect(frames).toEqual([null]);
  });

  it('does not report nobody before the camera is ready', async () => {
    const frames: Array<PoseResult | null> = [];
    let now = 1_000;
    const queue: FrameRequestCallback[] = [];
    const controller = new PosePreviewController({
      getVideo: () => video(0),
      poseDetector: {
        initialize: async () => undefined,
        isReady: () => false,
        processFrame: () => null,
        dispose: () => undefined,
      },
      now: () => now,
      raf: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      caf: () => {
        queue.length = 0;
      },
    });

    controller.subscribe((frame) => frames.push(frame.pose));
    await controller.start();
    now = 1_000 + POSE_PREVIEW_STALE_MS * 4;
    queue.shift()?.(now);
    expect(frames).toEqual([]);
  });

  it('does not emit after stop', async () => {
    const seen: number[] = [];
    let now = 1_000;
    const queue: FrameRequestCallback[] = [];
    const controller = new PosePreviewController({
      getVideo: () => video(),
      poseDetector: {
        initialize: async () => undefined,
        isReady: () => true,
        processFrame: () => pose(now),
        dispose: () => undefined,
      },
      now: () => now,
      raf: (cb) => {
        queue.push(cb);
        return 1;
      },
      caf: (id) => {
        void id;
        queue.length = 0;
      },
    });

    controller.subscribe(() => seen.push(now));
    await controller.start();
    controller.stop();
    now = 1_200;
    queue.shift()?.(now);
    expect(seen).toEqual([1_000]);
    expect(controller.isActive()).toBe(false);
  });
});
