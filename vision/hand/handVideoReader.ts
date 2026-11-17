import type { HandDetector, HandFrameResult } from './HandDetector';

type HandFrameSource = Pick<HandDetector, 'processFrame'>;
type ReadPath = 'video' | 'copy';

/** How often an empty read may also try the other path, in milliseconds. */
export const HAND_PATH_RETRY_MS = 500;

/**
 * Runs hand detection on a video. Some GPU/video paths hand MediaPipe an empty
 * or unreadable texture, while a canvas copy of the same frame works. The
 * reader uses one path per frame and, while it finds no hand, tries the other
 * path at most every `retryMs`. Whichever path last found a hand is kept, so a
 * frame normally costs one detection, not two.
 */
export class HandVideoReader {
  private scratch: HTMLCanvasElement | null = null;
  private path: ReadPath = 'video';
  private lastRetryAt = -Infinity;

  constructor(private readonly retryMs: number = HAND_PATH_RETRY_MS) {}

  /**
   * Hands for this frame. Null means the frame could not be read, which is not
   * a lost hand: callers should keep the previous hands.
   */
  read(detector: HandFrameSource, video: HTMLVideoElement, timestamp: number): HandFrameResult | null {
    const first = this.readPath(this.path, detector, video, timestamp);
    if (first && first.hands.length > 0) return first;
    if (timestamp - this.lastRetryAt < this.retryMs) return first;

    this.lastRetryAt = timestamp;
    const other: ReadPath = this.path === 'video' ? 'copy' : 'video';
    const second = this.readPath(other, detector, video, timestamp);
    if (second && second.hands.length > 0) {
      this.path = other;
      return second;
    }
    // An unreadable frame stays null even if the other path saw nothing, so callers keep the last hands.
    return first;
  }

  private readPath(
    path: ReadPath,
    detector: HandFrameSource,
    video: HTMLVideoElement,
    timestamp: number,
  ): HandFrameResult | null {
    if (path === 'video') return detector.processFrame(video, timestamp);
    const copied = this.copy(video);
    return copied ? detector.processFrame(copied, timestamp) : null;
  }

  private copy(video: HTMLVideoElement): HTMLCanvasElement | null {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width < 2 || height < 2) return null;
    if (!this.scratch) this.scratch = document.createElement('canvas');
    if (this.scratch.width !== width) this.scratch.width = width;
    if (this.scratch.height !== height) this.scratch.height = height;
    const ctx = this.scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return this.scratch;
  }
}

/** After a refused play(), wait this long before asking again. */
export const PLAY_RETRY_MS = 1000;

const playState = new WeakMap<HTMLVideoElement, { pending: boolean; nextAt: number }>();

/**
 * A hidden, muted preview can be paused by the browser. Restart it so frames
 * keep advancing, without stacking play() calls or retrying a refusal every frame.
 */
export function keepVideoPlaying(video: HTMLVideoElement, nowMs: number = Date.now()): void {
  if (!video.paused || !video.srcObject) return;
  const state = playState.get(video) ?? { pending: false, nextAt: 0 };
  if (state.pending || nowMs < state.nextAt) return;
  state.pending = true;
  playState.set(video, state);
  void video
    .play()
    .then(() => {
      state.nextAt = 0;
    })
    .catch(() => {
      state.nextAt = Date.now() + PLAY_RETRY_MS;
    })
    .finally(() => {
      state.pending = false;
    });
}
