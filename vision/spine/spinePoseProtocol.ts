import type { SpineKeypoints } from './spineTrack';

export type SpinePoseBackend = 'webgpu' | 'wasm';

export type SpineWorkerRequest = { type: 'load' } | { type: 'run'; id: number; frame: ImageBitmap };

export type SpineWorkerReply =
  | { type: 'loaded'; backend: SpinePoseBackend }
  | { type: 'load-failed'; message: string }
  | { type: 'result'; id: number; keypoints: SpineKeypoints }
  | { type: 'run-failed'; id: number; message: string };
