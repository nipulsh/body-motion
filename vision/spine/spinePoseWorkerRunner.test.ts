import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import { createSpinePoseWorkerRunner, type SpineWorkerLike } from './spinePoseWorkerRunner';
import type { SpineWorkerReply, SpineWorkerRequest } from './spinePoseProtocol';

const CONFIG = VISION_CONFIG.spinePose;

class FakeWorker implements SpineWorkerLike {
  onmessage: ((event: { data: SpineWorkerReply }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: { message: SpineWorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  postMessage(message: SpineWorkerRequest, transfer: Transferable[] = []): void {
    this.sent.push({ message, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: SpineWorkerReply): void {
    this.onmessage?.({ data });
  }
}

const BITMAP = { close: vi.fn() } as unknown as ImageBitmap;
const KEYPOINTS = { x: new Float32Array(1), y: new Float32Array(1), score: new Float32Array(1) };

function setup() {
  const worker = new FakeWorker();
  const runner = createSpinePoseWorkerRunner(() => Promise.resolve(worker));
  return { worker, runner };
}

const tick = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('spinePose worker runner', () => {
  it('loads through the worker and reports which backend it got', async () => {
    const { worker, runner } = setup();
    const loading = runner.load();
    await tick();
    expect(worker.sent[0]!.message.type).toBe('load');
    worker.reply({ type: 'loaded', backend: 'wasm' });
    await expect(loading).resolves.toBeUndefined();
    expect(runner.backend()).toBe('wasm');
  });

  it('rejects the load with the reason the worker gave', async () => {
    const { worker, runner } = setup();
    const loading = runner.load();
    await tick();
    worker.reply({ type: 'load-failed', message: 'hash mismatch' });
    await expect(loading).rejects.toThrow(/hash mismatch/);
  });

  it('times out a download that never finishes', async () => {
    const { runner } = setup();
    const loading = runner.load();
    const check = expect(loading).rejects.toThrow(/timed out/i);
    await tick();
    await vi.advanceTimersByTimeAsync(CONFIG.loadTimeoutMs + 1);
    await check;
  });

  it('hands the bitmap over rather than copying it, and matches replies to requests by id', async () => {
    const { worker, runner } = setup();
    const loading = runner.load();
    await tick();
    worker.reply({ type: 'loaded', backend: 'wasm' });
    await loading;
    const first = runner.run(BITMAP);
    const sent = worker.sent[1]!;
    expect(sent.transfer).toContain(BITMAP);
    if (sent.message.type !== 'run') throw new Error('expected a run request');
    worker.reply({ type: 'result', id: sent.message.id + 99, keypoints: KEYPOINTS });
    worker.reply({ type: 'result', id: sent.message.id, keypoints: KEYPOINTS });
    await expect(first).resolves.toBe(KEYPOINTS);
  });

  it('rejects an inference the worker reports as failed', async () => {
    const { worker, runner } = setup();
    const loading = runner.load();
    await tick();
    worker.reply({ type: 'loaded', backend: 'wasm' });
    await loading;
    const pending = runner.run(BITMAP);
    const sent = worker.sent[1]!;
    if (sent.message.type !== 'run') throw new Error('expected a run request');
    worker.reply({ type: 'run-failed', id: sent.message.id, message: 'bad tensor' });
    await expect(pending).rejects.toThrow(/bad tensor/);
  });

  it('times out an inference that never returns', async () => {
    const { worker, runner } = setup();
    const loading = runner.load();
    await tick();
    worker.reply({ type: 'loaded', backend: 'wasm' });
    await loading;
    const pending = runner.run(BITMAP);
    const check = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(CONFIG.runTimeoutMs + 1);
    await check;
  });

  it('rejects whatever is pending when the worker dies', async () => {
    const { worker, runner } = setup();
    const loading = runner.load();
    await tick();
    worker.reply({ type: 'loaded', backend: 'wasm' });
    await loading;
    const pending = runner.run(BITMAP);
    worker.onerror?.({ message: 'out of memory' });
    await expect(pending).rejects.toThrow(/out of memory/);
  });

  it('terminates the worker on dispose and rejects anything still pending', async () => {
    const { worker, runner } = setup();
    const loading = runner.load();
    await tick();
    worker.reply({ type: 'loaded', backend: 'wasm' });
    await loading;
    const pending = runner.run(BITMAP);
    runner.dispose();
    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toThrow();
  });

  it('closes the bitmap and rejects when asked to run before loading', async () => {
    const close = vi.fn();
    const { runner } = setup();
    await expect(runner.run({ close } as unknown as ImageBitmap)).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects the load when the worker cannot be created', async () => {
    const runner = createSpinePoseWorkerRunner(() => Promise.reject(new Error('workers blocked')));
    await expect(runner.load()).rejects.toThrow(/workers blocked/);
  });
});
