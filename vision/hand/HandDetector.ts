import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { VISION_CONFIG } from '../config';
import { VisionError } from '../errors';

type MediaPipeDelegate = 'GPU' | 'CPU';

function canReadHandFrame(frame: HTMLVideoElement | HTMLCanvasElement): boolean {
  if ('readyState' in frame) return frame.readyState >= 2;
  return frame.width >= 2 && frame.height >= 2;
}

/**
 * HandLandmarker documents `landmarks` as one array per hand. A flat 21-point
 * list is still one detected hand; treating each point as a hand drops them all.
 */
function isLandmark(value: unknown): value is NormalizedLandmark {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof (value as NormalizedLandmark).x === 'number';
}

function handLandmarkSets(
  landmarks: readonly NormalizedLandmark[][] | readonly NormalizedLandmark[] | undefined,
): readonly (readonly NormalizedLandmark[])[] {
  if (!landmarks?.length) return [];
  const first: unknown = landmarks[0];
  if (isLandmark(first)) return [landmarks as readonly NormalizedLandmark[]];
  return landmarks as readonly NormalizedLandmark[][];
}

function copyHandLandmark(landmark: NormalizedLandmark): NormalizedLandmark {
  const source = landmark as NormalizedLandmark & { presence?: number };
  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility,
    ...(typeof source.presence === 'number' ? { presence: source.presence } : {}),
  };
}

export interface DetectedHand {
  landmarks: readonly NormalizedLandmark[];
  handedness: string | null;
}

export interface HandFrameResult {
  /** First detected hand. The fingertip trail uses this. Click tracking chooses its own hand from `hands`. */
  landmarks: readonly NormalizedLandmark[];
  handedness: string | null;
  /** Every detected hand, up to the configured hand count. */
  hands: readonly DetectedHand[];
  timestamp: number;
}

export class HandDetector {
  private landmarker: HandLandmarker | null = null;
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

  processFrame(
    video: HTMLVideoElement | HTMLCanvasElement,
    timestamp: number,
  ): HandFrameResult | null {
    if (!this.landmarker) return null;
    if (!canReadHandFrame(video)) return null;

    const nextTimestamp = Math.max(timestamp, this.lastTimestamp + 1);
    this.lastTimestamp = nextTimestamp;
    let result;
    try {
      result = this.landmarker.detectForVideo(video, nextTimestamp);
    } catch {
      return null;
    }
    const hands: DetectedHand[] = [];
    const landmarkSets = handLandmarkSets(result.landmarks);
    const handedness = result.handedness ?? result.handednesses;
    for (let index = 0; index < landmarkSets.length; index += 1) {
      const landmarks = landmarkSets[index];
      if (!landmarks?.length) continue;
      hands.push({
        landmarks: landmarks.map(copyHandLandmark),
        handedness: handedness?.[index]?.[0]?.categoryName ?? null,
      });
    }
    const first = hands[0];

    return {
      landmarks: first?.landmarks ?? [],
      handedness: first?.handedness ?? null,
      hands,
      timestamp: nextTimestamp,
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
        err instanceof Error ? err.message : 'Failed to initialize hand tracking.',
        err,
      );
    }
  }

  private createWithDelegate(
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: MediaPipeDelegate,
  ): Promise<HandLandmarker> {
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: VISION_CONFIG.mediapipe.handModelAssetPath,
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: VISION_CONFIG.mediapipe.numHands,
      minHandDetectionConfidence: 0.25,
      minHandPresenceConfidence: 0.25,
      minTrackingConfidence: 0.25,
    });
  }
}
