/// <reference lib="webworker" />
/**
 * Runs SpinePose off the main thread. The camera loop, rep counter, and voice coaching keep their
 * frame budget however long inference takes, on WebGPU or on the CPU.
 */
import * as ort from 'onnxruntime-web/webgpu';
import { VISION_CONFIG } from '../config';
import { createSpinePoseEngine, type SpinePoseEngine, type SpinePoseOrt } from './spinePoseEngine';
import type { SpineWorkerReply, SpineWorkerRequest } from './spinePoseProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const config = VISION_CONFIG.spinePose;

let engine: SpinePoseEngine | null = null;
let canvas: OffscreenCanvasRenderingContext2D | null = null;

function reply(message: SpineWorkerReply, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readPixels(frame: ImageBitmap): Uint8ClampedArray {
  if (!canvas) {
    canvas = new OffscreenCanvas(config.inputWidth, config.inputHeight).getContext('2d', { willReadFrequently: true });
    if (!canvas) throw new Error('A 2D canvas is not available in this worker.');
  }
  // The crop can run past the frame edge. That part arrives transparent and must read as black.
  canvas.fillStyle = '#000';
  canvas.fillRect(0, 0, config.inputWidth, config.inputHeight);
  canvas.drawImage(frame, 0, 0, config.inputWidth, config.inputHeight);
  return canvas.getImageData(0, 0, config.inputWidth, config.inputHeight).data;
}

async function load(): Promise<void> {
  try {
    engine = await createSpinePoseEngine({
      ort: ort as unknown as SpinePoseOrt,
      fetch: (input, init) => fetch(input, init),
      digest: sha256Hex,
      hasWebGpu: () => 'gpu' in navigator,
      config,
    });
    reply({ type: 'loaded', backend: engine.backend });
  } catch (error) {
    reply({ type: 'load-failed', message: messageOf(error) });
  }
}

async function run(id: number, frame: ImageBitmap): Promise<void> {
  try {
    if (!engine) throw new Error('The spine model is not loaded.');
    const pixels = readPixels(frame);
    const keypoints = await engine.run(pixels);
    reply({ type: 'result', id, keypoints }, [keypoints.x.buffer, keypoints.y.buffer, keypoints.score.buffer]);
  } catch (error) {
    reply({ type: 'run-failed', id, message: messageOf(error) });
  } finally {
    frame.close();
  }
}

scope.onmessage = (event: MessageEvent<SpineWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'load') void load();
  else void run(message.id, message.frame);
};
