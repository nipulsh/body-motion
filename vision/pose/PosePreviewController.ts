import { VISION_CONFIG } from '../config';
import type { PoseDetectorLike } from '../scanning/ScanController';
import type { PoseResult } from '../types';

export const POSE_PREVIEW_STALE_MS = 500;

export interface PosePreviewFrame {
  pose: PoseResult | null;
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
}

export type PosePreviewListener = (frame: PosePreviewFrame) => void;

export interface PosePreviewControllerDeps {
  getVideo: () => HTMLVideoElement | null;
  poseDetector: PoseDetectorLike;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

export class PosePreviewController {
  private readonly getVideo: () => HTMLVideoElement | null;
  private readonly poseDetector: PoseDetectorLike;
  private readonly raf: (cb: FrameRequestCallback) => number;
  private readonly caf: (id: number) => void;
  private readonly now: () => number;
  private readonly listeners = new Set<PosePreviewListener>();

  private active = false;
  private rafId = 0;
  private startToken = 0;
  private lastFrameAt = 0;
  private lastGoodAt = 0;
  private cleared = true;

  constructor(deps: PosePreviewControllerDeps) {
    this.getVideo = deps.getVideo;
    this.poseDetector = deps.poseDetector;
    this.raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
    this.now = deps.now ?? (() => performance.now());
  }

  subscribe(listener: PosePreviewListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    const token = ++this.startToken;
    await this.poseDetector.initialize();
    if (token !== this.startToken) return;
    if (this.active) return;
    this.active = true;
    this.lastFrameAt = 0;
    this.lastGoodAt = 0;
    this.cleared = true;
    this.loop();
  }

  stop(): void {
    this.startToken += 1;
    this.active = false;
    this.lastGoodAt = 0;
    this.cleared = true;
    if (this.rafId) {
      this.caf(this.rafId);
      this.rafId = 0;
    }
  }

  private loop(): void {
    if (!this.active) return;

    const timestamp = this.now();
    const minIntervalMs = 1000 / VISION_CONFIG.motion.processingFps;
    if (timestamp - this.lastFrameAt >= minIntervalMs) {
      this.lastFrameAt = timestamp;
      this.process(timestamp);
    }

    this.rafId = this.raf(() => this.loop());
  }

  private process(timestamp: number): void {
    const video = this.getVideo();
    const usable = Boolean(video && video.readyState >= 2 && this.poseDetector.isReady());
    if (!usable || !video) {
      this.expire(timestamp, video);
      return;
    }

    const pose = this.poseDetector.processFrame(video, timestamp);
    if (!pose) {
      this.expire(timestamp, video);
      return;
    }

    this.lastGoodAt = timestamp;
    this.cleared = false;
    this.emit({
      pose,
      timestamp,
      frameWidth: video.videoWidth,
      frameHeight: video.videoHeight,
    });
  }

  private expire(timestamp: number, video: HTMLVideoElement | null): void {
    if (this.cleared) return;
    if (timestamp - this.lastGoodAt < POSE_PREVIEW_STALE_MS) return;
    this.cleared = true;
    this.emit({
      pose: null,
      timestamp,
      frameWidth: video?.videoWidth ?? 0,
      frameHeight: video?.videoHeight ?? 0,
    });
  }

  private emit(frame: PosePreviewFrame): void {
    for (const listener of this.listeners) {
      listener(frame);
    }
  }
}
