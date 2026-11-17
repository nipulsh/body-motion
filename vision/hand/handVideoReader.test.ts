import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandFrameResult } from './HandDetector';
import { HAND_PATH_RETRY_MS, HandVideoReader, keepVideoPlaying, PLAY_RETRY_MS } from './handVideoReader';

function frame(handCount: number): HandFrameResult {
  const hands = Array.from({ length: handCount }, () => ({
    landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 })),
    handedness: 'Left',
  }));
  return { landmarks: hands[0]?.landmarks ?? [], handedness: hands[0]?.handedness ?? null, hands, timestamp: 1 };
}

function fakeVideo(width = 640, height = 480): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height, readyState: 4 } as unknown as HTMLVideoElement;
}

describe('HandVideoReader', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stand-in for the scratch canvas; vision tests run without a DOM. */
  const canvas = { width: 0, height: 0, getContext: vi.fn() };
  const mockCanvas = () => {
    canvas.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() });
    vi.stubGlobal('document', { createElement: () => canvas });
    return canvas.getContext;
  };
  const isCopy = (source: unknown) => source === canvas;

  it('returns the direct read when it finds a hand', () => {
    mockCanvas();
    const processFrame = vi.fn().mockReturnValueOnce(frame(1));
    const result = new HandVideoReader().read({ processFrame }, fakeVideo(), 10);
    expect(result?.hands).toHaveLength(1);
    expect(processFrame).toHaveBeenCalledTimes(1);
  });

  it('retries on a canvas copy when the video read finds no hand', () => {
    mockCanvas();
    const processFrame = vi.fn().mockReturnValueOnce(frame(0)).mockReturnValueOnce(frame(2));
    const result = new HandVideoReader().read({ processFrame }, fakeVideo(), 10);
    expect(result?.hands).toHaveLength(2);
    expect(processFrame).toHaveBeenCalledTimes(2);
    expect(processFrame.mock.calls[1]![0]).toBe(canvas);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it('runs one detection per frame while no hand is in view, retrying only every 500 ms', () => {
    mockCanvas();
    const processFrame = vi.fn().mockReturnValue(frame(0));
    const reader = new HandVideoReader();
    for (let t = 0; t < 1000; t += 33) reader.read({ processFrame }, fakeVideo(), t);
    const frames = Math.ceil(1000 / 33);
    const retries = Math.ceil(1000 / HAND_PATH_RETRY_MS);
    expect(processFrame.mock.calls.length).toBeLessThanOrEqual(frames + retries);
    expect(processFrame.mock.calls.filter(([source]) => isCopy(source)).length).toBeLessThanOrEqual(retries);
  });

  it('stays on the canvas copy once only the copy finds hands', () => {
    mockCanvas();
    const processFrame = vi.fn((source: unknown) => (isCopy(source) ? frame(1) : frame(0)));
    const reader = new HandVideoReader();
    reader.read({ processFrame }, fakeVideo(), 0);
    processFrame.mockClear();
    for (let t = 33; t < 300; t += 33) {
      expect(reader.read({ processFrame }, fakeVideo(), t)?.hands).toHaveLength(1);
    }
    expect(processFrame.mock.calls.every(([source]) => isCopy(source))).toBe(true);
  });

  it('reports an unreadable frame as null so callers keep the last hands', () => {
    mockCanvas();
    const processFrame = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(frame(0));
    expect(new HandVideoReader().read({ processFrame }, fakeVideo(), 10)).toBeNull();
  });

  it('does not copy a video without frame dimensions', () => {
    const getContext = mockCanvas();
    const processFrame = vi.fn().mockReturnValueOnce(null);
    expect(new HandVideoReader().read({ processFrame }, fakeVideo(0, 0), 10)).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
  });
});

describe('keepVideoPlaying', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('restarts a paused preview that has a stream', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    keepVideoPlaying({ paused: true, srcObject: {}, play } as unknown as HTMLVideoElement);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('leaves a playing or detached video alone', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    keepVideoPlaying({ paused: false, srcObject: {}, play } as unknown as HTMLVideoElement);
    keepVideoPlaying({ paused: true, srcObject: null, play } as unknown as HTMLVideoElement);
    expect(play).not.toHaveBeenCalled();
  });

  it('does not stack calls while play() is pending', () => {
    const play = vi.fn(() => new Promise<void>(() => {}));
    const video = { paused: true, srcObject: {}, play } as unknown as HTMLVideoElement;
    for (let i = 0; i < 10; i += 1) keepVideoPlaying(video, i);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('backs off after the browser refuses to play', async () => {
    const play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const video = { paused: true, srcObject: {}, play } as unknown as HTMLVideoElement;
    const start = Date.now();
    keepVideoPlaying(video, start);
    await flush();
    keepVideoPlaying(video, start + 16);
    keepVideoPlaying(video, start + 500);
    expect(play).toHaveBeenCalledTimes(1);
    keepVideoPlaying(video, start + PLAY_RETRY_MS + 100);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
