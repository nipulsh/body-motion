import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import { createSpinePoseEngine, type SpinePoseEngineDeps, type SpinePoseOrt } from './spinePoseEngine';
import { SPINE_TRACK_KEYPOINTS } from './spineTrack';

const CONFIG = VISION_CONFIG.spinePose;
const X_BINS = CONFIG.inputWidth * CONFIG.simccSplitRatio;
const Y_BINS = CONFIG.inputHeight * CONFIG.simccSplitRatio;

const MODEL = new TextEncoder().encode('pretend onnx bytes').buffer as ArrayBuffer;
const MODEL_SHA = createHash('sha256').update(new Uint8Array(MODEL)).digest('hex');

function output(bins: number, keypoints = SPINE_TRACK_KEYPOINTS) {
  const data = new Float32Array(keypoints * bins);
  for (let k = 0; k < keypoints; k += 1) data[k * bins + 7] = 1.5;
  return { data, dims: [1, keypoints, bins] };
}

function fakeOrt(overrides: { create?: SpinePoseOrt['InferenceSession']['create'] } = {}) {
  const run = vi.fn(async () => ({ simcc_x: output(X_BINS), simcc_y: output(Y_BINS) }));
  const session = { inputNames: ['input'], outputNames: ['simcc_x', 'simcc_y'], run, release: vi.fn(async () => {}) };
  const create = vi.fn(overrides.create ?? (async () => session));
  const ort: SpinePoseOrt = {
    env: { wasm: {} },
    InferenceSession: { create },
    Tensor: class {
      constructor(
        readonly type: string,
        readonly data: Float32Array,
        readonly dims: readonly number[],
      ) {}
    } as unknown as SpinePoseOrt['Tensor'],
  };
  return { ort, create, run, session };
}

function deps(ort: SpinePoseOrt, fetchImpl?: SpinePoseEngineDeps['fetch']): SpinePoseEngineDeps {
  return {
    ort,
    fetch: fetchImpl ?? (vi.fn(async () => new Response(MODEL)) as unknown as SpinePoseEngineDeps['fetch']),
    digest: async (bytes) => {
      const hash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
      return hash;
    },
    hasWebGpu: () => false,
    config: { ...CONFIG, modelSha256: MODEL_SHA },
  };
}

const RGBA = new Uint8ClampedArray(CONFIG.inputWidth * CONFIG.inputHeight * 4);

describe('createSpinePoseEngine loading', () => {
  it('points the runtime at its own pinned wasm files before creating a session', async () => {
    const { ort, create, session } = fakeOrt();
    create.mockImplementationOnce(async () => {
      expect(ort.env.wasm.wasmPaths).toBe(CONFIG.wasmPath);
      return session;
    });
    await createSpinePoseEngine(deps(ort));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses a model whose bytes do not match the pinned hash, and never hands it to the runtime', async () => {
    const { ort, create } = fakeOrt();
    const tampered = new TextEncoder().encode('tampered').buffer as ArrayBuffer;
    const fetchImpl = vi.fn(async () => new Response(tampered));
    await expect(createSpinePoseEngine(deps(ort, fetchImpl as unknown as SpinePoseEngineDeps['fetch']))).rejects.toThrow(/hash/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('fails on an HTTP error instead of parsing the error page as a model', async () => {
    const { ort, create } = fakeOrt();
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(createSpinePoseEngine(deps(ort, fetchImpl as unknown as SpinePoseEngineDeps['fetch']))).rejects.toThrow(/503/);
    expect(create).not.toHaveBeenCalled();
  });

  it('prefers WebGPU when the device has it', async () => {
    const { ort, create } = fakeOrt();
    await createSpinePoseEngine({ ...deps(ort), hasWebGpu: () => true });
    expect(create.mock.calls[0]![1]).toMatchObject({ executionProviders: ['webgpu'] });
  });

  it('falls back to wasm when WebGPU cannot start', async () => {
    const { ort, create, session } = fakeOrt();
    create.mockRejectedValueOnce(new Error('no adapter')).mockResolvedValueOnce(session);
    const engine = await createSpinePoseEngine({ ...deps(ort), hasWebGpu: () => true });
    expect(create.mock.calls[1]![1]).toMatchObject({ executionProviders: ['wasm'] });
    expect(engine.backend).toBe('wasm');
  });

  it('skips WebGPU altogether on a device without it', async () => {
    const { ort, create } = fakeOrt();
    const engine = await createSpinePoseEngine(deps(ort));
    expect(create.mock.calls[0]![1]).toMatchObject({ executionProviders: ['wasm'] });
    expect(engine.backend).toBe('wasm');
  });

  it('runs once while loading, so shaders compile before the first camera frame is on a deadline', async () => {
    const { ort, run } = fakeOrt();
    await createSpinePoseEngine(deps(ort));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to wasm when WebGPU opens the model but cannot run it, and frees the broken session', async () => {
    const brokenRelease = vi.fn();
    const broken = {
      inputNames: ['input'],
      outputNames: ['simcc_x', 'simcc_y'],
      run: vi.fn(async () => {
        throw new Error('device lost');
      }),
      release: brokenRelease,
    };
    const { ort, create } = fakeOrt();
    const good = {
      inputNames: ['input'],
      outputNames: ['simcc_x', 'simcc_y'],
      run: vi.fn(async () => ({ simcc_x: output(X_BINS), simcc_y: output(Y_BINS) })),
      release: vi.fn(),
    };
    create.mockResolvedValueOnce(broken).mockResolvedValueOnce(good);
    const engine = await createSpinePoseEngine({ ...deps(ort), hasWebGpu: () => true });
    expect(engine.backend).toBe('wasm');
    expect(brokenRelease).toHaveBeenCalledTimes(1);
  });

  it('fails the load when wasm cannot run the model either', async () => {
    const { ort, run } = fakeOrt();
    run.mockRejectedValue(new Error('out of memory'));
    await expect(createSpinePoseEngine(deps(ort))).rejects.toThrow(/out of memory/);
  });

  it('fails the load on a model that does not output the SpineTrack skeleton', async () => {
    const { ort, run } = fakeOrt();
    run.mockResolvedValue({ simcc_x: output(X_BINS, 17), simcc_y: output(Y_BINS, 17) });
    await expect(createSpinePoseEngine(deps(ort))).rejects.toThrow(/keypoints/i);
  });
});

describe('createSpinePoseEngine inference', () => {
  it('feeds a 1×3×256×192 float tensor and decodes all 37 keypoints', async () => {
    const { ort, run } = fakeOrt();
    const engine = await createSpinePoseEngine(deps(ort));
    const decoded = await engine.run(RGBA);
    expect(decoded.x).toHaveLength(SPINE_TRACK_KEYPOINTS);
    expect(decoded.x[0]).toBe(3.5);
    expect(decoded.score[0]).toBeCloseTo(1.5, 5);
    const feeds = run.mock.calls[run.mock.calls.length - 1] as unknown as [
      Record<string, { dims: number[]; type: string; data: Float32Array }>,
    ];
    expect(feeds[0].input!.dims).toEqual([1, 3, CONFIG.inputHeight, CONFIG.inputWidth]);
    expect(feeds[0].input!.type).toBe('float32');
    expect(feeds[0].input!.data).toHaveLength(3 * CONFIG.inputHeight * CONFIG.inputWidth);
  });

  it('rejects an output that stops matching the SpineTrack skeleton later on', async () => {
    const { ort, run } = fakeOrt();
    const engine = await createSpinePoseEngine(deps(ort));
    run.mockResolvedValueOnce({ simcc_x: output(X_BINS, 17), simcc_y: output(Y_BINS, 17) });
    await expect(engine.run(RGBA)).rejects.toThrow(/keypoints/i);
  });

  it('rejects a frame of the wrong size', async () => {
    const { ort } = fakeOrt();
    const engine = await createSpinePoseEngine(deps(ort));
    await expect(engine.run(new Uint8ClampedArray(16))).rejects.toThrow();
  });
});

describe('spinePose config guard', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(resolve(here, '../../app/package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };

  it('loads wasm files from exactly the runtime version the app installs', () => {
    const installed = pkg.dependencies['onnxruntime-web']!;
    expect(installed).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CONFIG.wasmPath).toContain(`onnxruntime-web@${installed}/`);
  });

  it('pins the model to a commit and a hash, not to a moving branch', () => {
    expect(CONFIG.modelUrl).toMatch(/\/resolve\/[0-9a-f]{40}\//);
    expect(CONFIG.modelSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
