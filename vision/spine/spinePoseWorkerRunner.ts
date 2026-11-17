import { VISION_CONFIG } from '../config';
import type { SpinePoseRunner } from './SpinePoseEstimator';
import type { SpinePoseBackend, SpineWorkerReply, SpineWorkerRequest } from './spinePoseProtocol';
import type { SpineKeypoints } from './spineTrack';

type SpinePoseConfig = typeof VISION_CONFIG.spinePose;

export interface SpineWorkerLike {
  onmessage: ((event: { data: SpineWorkerReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: SpineWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface SpinePoseWorkerRunner extends SpinePoseRunner {
  backend(): SpinePoseBackend | null;
}

/**
 * Inline, so the worker is built from a Blob. The packaged app is served from file://, and a
 * worker script loaded from a file:// URL is refused.
 */
async function spawnSpinePoseWorker(): Promise<SpineWorkerLike> {
  const { default: SpinePoseWorker } = await import('./spinePose.worker?worker&inline');
  return new SpinePoseWorker() as unknown as SpineWorkerLike;
}

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function errorText(event: unknown): string {
  const message = (event as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : 'The spine model worker stopped.';
}

/** Speaks to the worker: one load, then inferences matched to their replies by id. */
export function createSpinePoseWorkerRunner(
  createWorker: () => Promise<SpineWorkerLike> = spawnSpinePoseWorker,
  config: SpinePoseConfig = VISION_CONFIG.spinePose,
): SpinePoseWorkerRunner {
  let worker: SpineWorkerLike | null = null;
  let disposed = false;
  let backend: SpinePoseBackend | null = null;
  let nextId = 1;
  let pendingLoad: Pending<void> | null = null;
  const pendingRuns = new Map<number, Pending<SpineKeypoints>>();

  const failAll = (error: Error) => {
    if (pendingLoad) {
      clearTimeout(pendingLoad.timer);
      pendingLoad.reject(error);
      pendingLoad = null;
    }
    for (const pending of pendingRuns.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingRuns.clear();
  };

  const onReply = (message: SpineWorkerReply) => {
    switch (message.type) {
      case 'loaded':
        backend = message.backend;
        if (pendingLoad) {
          clearTimeout(pendingLoad.timer);
          pendingLoad.resolve();
          pendingLoad = null;
        }
        return;
      case 'load-failed':
        if (pendingLoad) {
          clearTimeout(pendingLoad.timer);
          pendingLoad.reject(new Error(message.message));
          pendingLoad = null;
        }
        return;
      case 'result':
      case 'run-failed': {
        const pending = pendingRuns.get(message.id);
        if (!pending) return;
        pendingRuns.delete(message.id);
        clearTimeout(pending.timer);
        if (message.type === 'result') pending.resolve(message.keypoints);
        else pending.reject(new Error(message.message));
        return;
      }
    }
  };

  return {
    backend: () => backend,

    async load() {
      const created = await createWorker();
      if (disposed) {
        created.terminate();
        throw new Error('The spine model was shut down while loading.');
      }
      worker = created;
      worker.onmessage = (event) => onReply(event.data);
      worker.onerror = (event) => failAll(new Error(errorText(event)));
      await new Promise<void>((resolve, reject) => {
        pendingLoad = {
          resolve,
          reject,
          timer: setTimeout(() => {
            pendingLoad = null;
            reject(new Error('Loading the spine model timed out.'));
          }, config.loadTimeoutMs),
        };
        worker!.postMessage({ type: 'load' });
      });
    },

    run(frame) {
      if (!worker || disposed) {
        frame.close();
        return Promise.reject(new Error('The spine model is not loaded.'));
      }
      const active = worker;
      const id = nextId;
      nextId += 1;
      return new Promise<SpineKeypoints>((resolve, reject) => {
        pendingRuns.set(id, {
          resolve,
          reject,
          timer: setTimeout(() => {
            pendingRuns.delete(id);
            reject(new Error('The spine model timed out.'));
          }, config.runTimeoutMs),
        });
        active.postMessage({ type: 'run', id, frame }, [frame]);
      });
    },

    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      failAll(new Error('The spine model was shut down.'));
    },
  };
}
