import type { VISION_CONFIG } from '../config';
import { decodeSimcc, rgbaToInputTensor } from './spinePoseCodec';
import type { SpinePoseBackend } from './spinePoseProtocol';
import { SPINE_TRACK_KEYPOINTS, type SpineKeypoints } from './spineTrack';

type SpinePoseConfig = typeof VISION_CONFIG.spinePose;

interface OrtOutput {
  data: unknown;
  dims: readonly number[];
}

interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtOutput>>;
  release?(): Promise<void> | void;
}

/** The small part of onnxruntime-web this uses, so tests can stand in for it. */
export interface SpinePoseOrt {
  env: { wasm: { wasmPaths?: unknown } };
  InferenceSession: {
    create(model: Uint8Array, options: { executionProviders: string[] }): Promise<OrtSession>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}

export interface SpinePoseEngineDeps {
  ort: SpinePoseOrt;
  fetch: typeof fetch;
  /** Lowercase hex SHA-256. */
  digest: (bytes: ArrayBuffer) => Promise<string>;
  hasWebGpu: () => boolean;
  config: SpinePoseConfig;
}

export interface SpinePoseEngine {
  backend: SpinePoseBackend;
  /** RGBA pixels of the model's input size. */
  run(rgba: Uint8ClampedArray): Promise<SpineKeypoints>;
  release(): Promise<void>;
}

async function fetchVerifiedModel(deps: SpinePoseEngineDeps): Promise<Uint8Array> {
  const response = await deps.fetch(deps.config.modelUrl);
  if (!response.ok) throw new Error(`Spine model download failed with status ${response.status}.`);
  const bytes = await response.arrayBuffer();
  const hash = await deps.digest(bytes);
  if (hash !== deps.config.modelSha256) {
    throw new Error(`Spine model hash ${hash} does not match the pinned one.`);
  }
  return new Uint8Array(bytes);
}

function floatOutput(output: OrtOutput | undefined, name: string): { data: Float32Array; keypoints: number; bins: number } {
  if (!output || !(output.data instanceof Float32Array) || output.dims.length !== 3) {
    throw new Error(`Spine model output ${name} is not a float tensor of keypoints by bins.`);
  }
  return { data: output.data, keypoints: output.dims[1]!, bins: output.dims[2]! };
}

async function infer(deps: SpinePoseEngineDeps, session: OrtSession, rgba: Uint8ClampedArray): Promise<SpineKeypoints> {
  const { config, ort } = deps;
  const xBins = config.inputWidth * config.simccSplitRatio;
  const yBins = config.inputHeight * config.simccSplitRatio;
  const data = rgbaToInputTensor(rgba, config.inputWidth, config.inputHeight, config.mean, config.std);
  const input = new ort.Tensor('float32', data, [1, 3, config.inputHeight, config.inputWidth]);
  const outputs = await session.run({ [session.inputNames[0]!]: input });
  const x = floatOutput(outputs.simcc_x, 'simcc_x');
  const y = floatOutput(outputs.simcc_y, 'simcc_y');
  if (x.keypoints !== SPINE_TRACK_KEYPOINTS || y.keypoints !== SPINE_TRACK_KEYPOINTS || x.bins !== xBins || y.bins !== yBins) {
    throw new Error(`Spine model returned ${x.keypoints} keypoints by ${x.bins} bins, not the SpineTrack skeleton.`);
  }
  return decodeSimcc(x.data, y.data, SPINE_TRACK_KEYPOINTS, xBins, yBins, config.simccSplitRatio);
}

/**
 * Open the model and run it once. WebGPU compiles its shaders on the first run, which takes
 * seconds and would miss the deadline on a live camera frame. It can also open a model and then
 * fail to run it, which only this finds out in time to use the CPU instead.
 */
async function openAndWarmUp(deps: SpinePoseEngineDeps, model: Uint8Array, backend: SpinePoseBackend): Promise<OrtSession> {
  const { config } = deps;
  const session = await deps.ort.InferenceSession.create(model, { executionProviders: [backend] });
  try {
    await infer(deps, session, new Uint8ClampedArray(config.inputWidth * config.inputHeight * 4));
    return session;
  } catch (error) {
    await session.release?.();
    throw error;
  }
}

/** Download, verify, and open the model, then decode frames with it. Runs inside the worker. */
export async function createSpinePoseEngine(deps: SpinePoseEngineDeps): Promise<SpinePoseEngine> {
  deps.ort.env.wasm.wasmPaths = deps.config.wasmPath;
  const model = await fetchVerifiedModel(deps);
  let backend: SpinePoseBackend = 'wasm';
  let session: OrtSession | null = null;
  if (deps.hasWebGpu()) {
    try {
      session = await openAndWarmUp(deps, model, 'webgpu');
      backend = 'webgpu';
    } catch {
      // No usable adapter, an unsupported operator, or a lost device. The CPU needs nothing from the GPU.
    }
  }
  const opened = session ?? (await openAndWarmUp(deps, model, 'wasm'));
  return {
    backend,
    run: (rgba) => infer(deps, opened, rgba),
    async release() {
      await opened.release?.();
    },
  };
}
