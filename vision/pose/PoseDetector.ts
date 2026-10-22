import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { VISION_CONFIG } from '../config';
import { VisionError } from '../errors';
import type { PoseLandmark, PoseResult } from '../types';

type MediaPipeDelegate = 'GPU' | 'CPU';

function mapLandmarks(
  source: ReadonlyArray<{ x: number; y: number; z: number; visibility?: number; presence?: number }>,
): PoseLandmark[] {
  return source.map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0,
    ...(typeof lm.presence === 'number' ? { presence: lm.presence } : {}),
  }));
}

function meanVisibility(landmarks: readonly PoseLandmark[]): number {
  if (landmarks.length === 0) return 0;
  let sum = 0;
  for (const lm of landmarks) sum += lm.visibility;
  return sum / landmarks.length;
}

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private initializing: Promise<void> | null = null;
  private lastTimestamp = -1;

  isReady(): boolean {
    return this.landmarker !== null;
  }

  async initialize(): Promise<void> {
    if (this.landmarker) return;
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.createLandmarker();
    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  processFrame(video: HTMLVideoElement, timestamp: number): PoseResult | null {
    if (!this.landmarker) return null;
    if (video.readyState < 2) return null;
    if (timestamp <= this.lastTimestamp) return null;

    this.lastTimestamp = timestamp;
    const result = this.landmarker.detectForVideo(video, timestamp);
    const pose = result.landmarks[0];
    if (!pose || pose.length === 0) return null;

    const landmarks = mapLandmarks(pose);
    const world = result.worldLandmarks[0];
    const worldLandmarks = world && world.length > 0 ? mapLandmarks(world) : undefined;

    return {
      landmarks,
      worldLandmarks,
      confidence: meanVisibility(landmarks),
      timestamp,
    };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.initializing = null;
    this.lastTimestamp = -1;
  }

  private async createLandmarker(): Promise<void> {
    try {
      const fileset = await FilesetResolver.forVisionTasks(VISION_CONFIG.mediapipe.wasmAssetPath);
      try {
        this.landmarker = await this.createWithDelegate(fileset, VISION_CONFIG.mediapipe.delegate);
      } catch {
        this.landmarker = await this.createWithDelegate(fileset, 'CPU');
      }
    } catch (err) {
      throw new VisionError(
        'POSE_INIT_FAILED',
        err instanceof Error ? err.message : 'Failed to initialize pose tracking.',
        err,
      );
    }
  }

  private createWithDelegate(
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: MediaPipeDelegate,
  ): Promise<PoseLandmarker> {
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: VISION_CONFIG.mediapipe.modelAssetPath,
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: VISION_CONFIG.mediapipe.numPoses,
    });
  }
}
