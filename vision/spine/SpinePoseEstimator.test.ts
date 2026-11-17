import { describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import { hinge } from '../test/deadliftHinge';
import type { PoseResult } from '../types';
import { SpinePoseEstimator, type SpinePoseRunner } from './SpinePoseEstimator';
import { SPINE_CHAIN_IDS, SPINE_TRACK_KEYPOINTS } from './spineTrack';

const CONFIG = VISION_CONFIG.spinePose;
const VIDEO = { videoWidth: 640, videoHeight: 360, readyState: 4 } as unknown as HTMLVideoElement;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function keypoints(score = 1) {
  return {
    x: new Float32Array(SPINE_TRACK_KEYPOINTS).fill(96),
    y: new Float32Array(SPINE_TRACK_KEYPOINTS).fill(128),
    score: new Float32Array(SPINE_TRACK_KEYPOINTS).fill(score),
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

function setup(overrides: Partial<SpinePoseRunner> = {}) {
  const load = deferred<void>();
  const run = vi.fn(async () => keypoints());
  const runner: SpinePoseRunner = {
    load: vi.fn(() => load.promise),
    run,
    dispose: vi.fn(),
    ...overrides,
  };
  const capture = vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap);
  const warn = vi.fn();
  const createRunner = vi.fn(() => runner);
  const estimator = new SpinePoseEstimator({ createRunner, capture, warn, now: () => 0 });
  return { estimator, runner, run, capture, warn, createRunner, load };
}

async function ready(s: ReturnType<typeof setup>) {
  s.estimator.setEnabled(true);
  s.load.resolve();
  await flush();
}

const POSE: PoseResult = hinge();

describe('SpinePoseEstimator lifecycle', () => {
  it('does nothing, and loads nothing, until it is enabled', () => {
    const s = setup();
    expect(s.estimator.update(VIDEO, POSE, 0)).toBeNull();
    expect(s.createRunner).not.toHaveBeenCalled();
    expect(s.estimator.getStatus()).toBe('idle');
  });

  it('loads once in the background and does not wait for the model to return frames', async () => {
    const s = setup();
    s.estimator.setEnabled(true);
    s.estimator.setEnabled(true);
    expect(s.estimator.getStatus()).toBe('loading');
    expect(s.estimator.update(VIDEO, POSE, 0)).toBeNull();
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.runner.load).toHaveBeenCalledTimes(1);
    s.load.resolve();
    await flush();
    expect(s.estimator.getStatus()).toBe('ready');
  });

  it('keeps the model across sets, so a rest does not download it again', async () => {
    const s = setup();
    await ready(s);
    s.estimator.setEnabled(false);
    s.estimator.setEnabled(true);
    expect(s.createRunner).toHaveBeenCalledTimes(1);
    expect(s.estimator.getStatus()).toBe('ready');
  });

  it('reports a failed load once, returns nothing, and tries again on the next set only', async () => {
    const s = setup();
    s.estimator.setEnabled(true);
    s.load.reject(new Error('offline'));
    await flush();
    expect(s.estimator.getStatus()).toBe('failed');
    expect(s.warn).toHaveBeenCalledTimes(1);
    expect(s.estimator.update(VIDEO, POSE, 100)).toBeNull();
    expect(s.estimator.update(VIDEO, POSE, 200)).toBeNull();
    expect(s.runner.load).toHaveBeenCalledTimes(1);
    expect(s.runner.dispose).toHaveBeenCalledTimes(1);
    s.estimator.setEnabled(false);
    s.estimator.setEnabled(true);
    expect(s.createRunner).toHaveBeenCalledTimes(2);
  });

  it('treats a runner that cannot be created as a failed load', async () => {
    const warn = vi.fn();
    const estimator = new SpinePoseEstimator({
      createRunner: () => {
        throw new Error('no workers here');
      },
      capture: vi.fn(),
      warn,
    });
    estimator.setEnabled(true);
    await flush();
    expect(estimator.getStatus()).toBe('failed');
    expect(estimator.update(VIDEO, POSE, 0)).toBeNull();
  });

  it('disposes the runner and ignores a load that finishes afterwards', async () => {
    const s = setup();
    s.estimator.setEnabled(true);
    s.estimator.dispose();
    s.load.resolve();
    await flush();
    expect(s.runner.dispose).toHaveBeenCalled();
    expect(s.estimator.getStatus()).toBe('idle');
    expect(s.estimator.update(VIDEO, POSE, 0)).toBeNull();
  });
});

describe('SpinePoseEstimator frames', () => {
  it('returns the spine chain in pelvis-to-skull order, on the frame it was captured from', async () => {
    const s = setup();
    await ready(s);
    const scores = new Float32Array(SPINE_TRACK_KEYPOINTS).fill(0);
    SPINE_CHAIN_IDS.forEach((id, order) => {
      scores[id] = (order + 1) / 10;
    });
    s.run.mockResolvedValueOnce({ ...keypoints(), score: scores });
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    const spine = s.estimator.update(VIDEO, POSE, 1010)!;
    expect(spine.capturedAt).toBe(1000);
    expect(spine.points.map((p) => p.score)).toEqual(SPINE_CHAIN_IDS.map((_, order) => expect.closeTo((order + 1) / 10, 5)));
  });

  it('runs one inference at a time: a slow model drops frames instead of queueing them', async () => {
    const s = setup();
    await ready(s);
    const slow = deferred<ReturnType<typeof keypoints>>();
    s.run.mockReturnValueOnce(slow.promise);
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    for (let t = 1100; t < 2000; t += 100) s.estimator.update(VIDEO, POSE, t);
    await flush();
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.run).toHaveBeenCalledTimes(1);
    slow.resolve(keypoints());
    await flush();
    s.estimator.update(VIDEO, POSE, 2100);
    await flush();
    expect(s.run).toHaveBeenCalledTimes(2);
  });

  it('does not run faster than the configured interval', async () => {
    const s = setup();
    await ready(s);
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    s.estimator.update(VIDEO, POSE, 1000 + CONFIG.minIntervalMs - 1);
    await flush();
    expect(s.run).toHaveBeenCalledTimes(1);
    s.estimator.update(VIDEO, POSE, 1000 + CONFIG.minIntervalMs);
    await flush();
    expect(s.run).toHaveBeenCalledTimes(2);
  });

  it('stops returning a result that has gone stale', async () => {
    const s = setup();
    await ready(s);
    const hang = deferred<ReturnType<typeof keypoints>>();
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    s.run.mockReturnValue(hang.promise);
    expect(s.estimator.update(VIDEO, POSE, 1000 + CONFIG.maxResultAgeMs)).not.toBeNull();
    expect(s.estimator.update(VIDEO, POSE, 1000 + CONFIG.maxResultAgeMs + 1)).toBeNull();
  });

  it('does not capture when there is no body to crop', async () => {
    const s = setup();
    await ready(s);
    const empty: PoseResult = { ...POSE, landmarks: [] };
    expect(s.estimator.update(VIDEO, empty, 1000)).toBeNull();
    await flush();
    expect(s.capture).not.toHaveBeenCalled();
  });

  it('does not capture a video that has no size yet', async () => {
    const s = setup();
    await ready(s);
    s.estimator.update({ videoWidth: 0, videoHeight: 0, readyState: 4 } as unknown as HTMLVideoElement, POSE, 1000);
    await flush();
    expect(s.capture).not.toHaveBeenCalled();
  });

  it('drops a result that arrives after the session stopped, and frees the bitmap of one that never ran', async () => {
    const s = setup();
    await ready(s);
    const late = deferred<ReturnType<typeof keypoints>>();
    s.run.mockReturnValueOnce(late.promise);
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    s.estimator.setEnabled(false);
    late.resolve(keypoints());
    await flush();
    s.estimator.setEnabled(true);
    expect(s.estimator.update(VIDEO, POSE, 1010)).toBeNull();
  });

  it('closes a captured frame when the session stops before it reaches the model', async () => {
    const s = setup();
    await ready(s);
    const close = vi.fn();
    const pending = deferred<ImageBitmap>();
    s.capture.mockReturnValueOnce(pending.promise);
    s.estimator.update(VIDEO, POSE, 1000);
    s.estimator.setEnabled(false);
    pending.resolve({ close } as unknown as ImageBitmap);
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(s.run).not.toHaveBeenCalled();
  });

  it('a result carrying numbers that are not finite is dropped, not returned', async () => {
    const s = setup();
    await ready(s);
    const bad = keypoints();
    bad.x[SPINE_CHAIN_IDS[3]!] = Number.NaN;
    s.run.mockResolvedValueOnce(bad);
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    expect(s.estimator.update(VIDEO, POSE, 1010)).toBeNull();
  });
});

describe('SpinePoseEstimator failures while running', () => {
  it('survives one failed inference', async () => {
    const s = setup();
    await ready(s);
    s.run.mockRejectedValueOnce(new Error('glitch'));
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    expect(s.estimator.getStatus()).toBe('ready');
    s.estimator.update(VIDEO, POSE, 1100);
    await flush();
    expect(s.estimator.update(VIDEO, POSE, 1110)).not.toBeNull();
  });

  it('survives a capture that throws, without an unhandled rejection', async () => {
    const s = setup();
    await ready(s);
    s.capture.mockRejectedValueOnce(new Error('video closed'));
    s.estimator.update(VIDEO, POSE, 1000);
    await flush();
    expect(s.estimator.getStatus()).toBe('ready');
    expect(s.run).not.toHaveBeenCalled();
  });

  it('gives up after repeated failures and stops capturing, so a broken model costs nothing', async () => {
    const s = setup();
    await ready(s);
    s.run.mockRejectedValue(new Error('broken'));
    let t = 1000;
    for (let i = 0; i < CONFIG.maxConsecutiveFailures; i += 1) {
      s.estimator.update(VIDEO, POSE, t);
      await flush();
      t += 100;
    }
    expect(s.estimator.getStatus()).toBe('failed');
    expect(s.runner.dispose).toHaveBeenCalled();
    const captures = s.capture.mock.calls.length;
    s.estimator.update(VIDEO, POSE, t);
    await flush();
    expect(s.capture.mock.calls.length).toBe(captures);
    expect(s.warn).toHaveBeenCalledTimes(1);
  });

  it('a success clears the failure count', async () => {
    const s = setup();
    await ready(s);
    let t = 1000;
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < CONFIG.maxConsecutiveFailures - 1; i += 1) {
        s.run.mockRejectedValueOnce(new Error('glitch'));
        s.estimator.update(VIDEO, POSE, t);
        await flush();
        t += 100;
      }
      s.estimator.update(VIDEO, POSE, t);
      await flush();
      t += 100;
    }
    expect(s.estimator.getStatus()).toBe('ready');
  });
});
