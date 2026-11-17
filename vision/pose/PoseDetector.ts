import { FilesetResolver, PoseLandmarker, type MPMask, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { VISION_CONFIG } from '../config';
import { VisionError } from '../errors';
import type { PoseLandmark, PoseResult, PoseSilhouette } from '../types';
import { PoseTargetLock } from './poseTargetLock';
import { silhouetteFromMask } from './silhouette';

type MediaPipeDelegate = 'GPU' | 'CPU';

/** `full` serves every screen. `heavy` is the most accurate model, for checks that need it. */
export type PoseModelVariant = 'full' | 'heavy';

function modelPath(variant: PoseModelVariant): string {
  return variant === 'heavy' ? VISION_CONFIG.mediapipe.heavyModelAssetPath : VISION_CONFIG.mediapipe.modelAssetPath;
}

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

/** Must run inside the detection callback: the mask is released once it returns. */
function readSilhouette(mask: MPMask | undefined): PoseSilhouette | undefined {
  if (!mask) return undefined;
  try {
    return silhouetteFromMask(mask.getAsFloat32Array(), mask.width, mask.height) ?? undefined;
  } catch {
    return undefined;
  }
}

function frameAspect(video: HTMLVideoElement): number | undefined {
  return video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : undefined;
}

/** `index` picks one of the bodies found in this frame. */
function toPoseResult(
  result: PoseLandmarkerResult,
  index: number,
  video: HTMLVideoElement,
  timestamp: number,
  silhouette: PoseSilhouette | undefined,
): PoseResult | null {
  const pose = result.landmarks[index];
  if (!pose || pose.length === 0) return null;

  const landmarks = mapLandmarks(pose);
  const aspect = frameAspect(video);
  const world = result.worldLandmarks?.[index];
  const worldLandmarks = world && world.length > 0 ? mapLandmarks(world) : undefined;

  return {
    landmarks,
    worldLandmarks,
    confidence: meanVisibility(landmarks),
    timestamp,
    ...(aspect !== undefined ? { frameAspect: aspect } : {}),
    ...(silhouette ? { silhouette } : {}),
  };
}

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private initializing: Promise<void> | null = null;
  private lastTimestamp = -1;
  /** What callers asked for; applied when the landmarker exists. */
  private segmentationWanted = false;
  /** What the current landmarker is configured with. */
  private segmentationOn = false;
  /** Model callers asked for; applied when the landmarker exists. */
  private modelWanted: PoseModelVariant = 'full';
  /** Model the current landmarker is running. */
  private modelOn: PoseModelVariant = 'full';
  /** Delegate the landmarker was created on. The heavy model is too slow for real time on the CPU. */
  private delegate: MediaPipeDelegate | null = null;
  private optionsQueue: Promise<void> = Promise.resolve();
  /** Only the locked person is returned, until they leave the mirror. */
  private readonly targetLock = new PoseTargetLock();

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

  /**
   * Attach the body outline (`PoseResult.silhouette`) to each frame. Costs a GPU read per
   * frame, so it is on only while a check needs it. Calls apply in order.
   */
  setSegmentationEnabled(enabled: boolean): Promise<void> {
    this.segmentationWanted = enabled;
    this.optionsQueue = this.optionsQueue.then(() => this.applySegmentation());
    return this.optionsQueue;
  }

  /**
   * Switch the landmark model. Frames keep coming from the current model while the other loads, and
   * a model that fails to load or is not suited to the device leaves the current one running.
   * Calls apply in order.
   */
  setModelVariant(variant: PoseModelVariant): Promise<void> {
    this.modelWanted = variant;
    this.optionsQueue = this.optionsQueue.then(() => this.applyModel());
    return this.optionsQueue;
  }

  /** The model frames are coming from now. */
  getModelVariant(): PoseModelVariant {
    return this.modelOn;
  }

  processFrame(video: HTMLVideoElement, timestamp: number): PoseResult | null {
    if (!this.landmarker) return null;
    if (video.readyState < 2) return null;
    if (timestamp <= this.lastTimestamp) return null;

    this.lastTimestamp = timestamp;
    if (!this.segmentationOn) {
      const result = this.landmarker.detectForVideo(video, timestamp);
      const index = this.lockedIndex(result, video, timestamp);
      return index === null ? null : toPoseResult(result, index, video, timestamp, undefined);
    }
    let output: PoseResult | null = null;
    this.landmarker.detectForVideo(video, timestamp, (result) => {
      const index = this.lockedIndex(result, video, timestamp);
      if (index === null) return;
      // Masks come one per body, in the same order as the landmarks.
      output = toPoseResult(result, index, video, timestamp, readSilhouette(result.segmentationMasks?.[index]));
    });
    return output;
  }

  /** Which of this frame's bodies is the locked person, or null when they are not in it. */
  private lockedIndex(result: PoseLandmarkerResult, video: HTMLVideoElement, timestamp: number): number | null {
    return this.targetLock.select(result.landmarks ?? [], timestamp, frameAspect(video));
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.initializing = null;
    this.lastTimestamp = -1;
    this.segmentationOn = false;
    this.targetLock.reset();
    this.modelOn = 'full';
    this.delegate = null;
  }

  private async applyModel(): Promise<void> {
    const landmarker = this.landmarker;
    const wanted = this.modelWanted === 'heavy' && this.delegate !== 'GPU' ? 'full' : this.modelWanted;
    if (!landmarker || this.modelOn === wanted) return;
    try {
      await landmarker.setOptions({ baseOptions: { modelAssetPath: modelPath(wanted) } });
      if (this.landmarker === landmarker) this.modelOn = wanted;
    } catch (err) {
      console.warn(`The ${wanted} pose model could not be loaded; staying on ${this.modelOn}.`, err);
      if (this.landmarker !== landmarker) return;
      // A failed download leaves the old model running. A model that loaded but would not start
      // may not have, so put the current one back.
      try {
        await landmarker.setOptions({ baseOptions: { modelAssetPath: modelPath(this.modelOn) } });
      } catch {
        // Nothing more to do here: processFrame keeps returning what the landmarker gives.
      }
    }
  }

  private async applySegmentation(): Promise<void> {
    const landmarker = this.landmarker;
    const wanted = this.segmentationWanted;
    if (!landmarker || this.segmentationOn === wanted) return;
    try {
      await landmarker.setOptions({ outputSegmentationMasks: wanted });
      if (this.landmarker === landmarker) this.segmentationOn = wanted;
    } catch (err) {
      if (this.landmarker === landmarker) this.segmentationOn = false;
      if (wanted) console.warn('Body outline is unavailable; back shape checks are off.', err);
    }
  }

  private async createLandmarker(): Promise<void> {
    try {
      const fileset = await FilesetResolver.forVisionTasks(VISION_CONFIG.mediapipe.wasmAssetPath);
      try {
        this.landmarker = await this.createWithDelegate(fileset, VISION_CONFIG.mediapipe.delegate);
        this.delegate = VISION_CONFIG.mediapipe.delegate;
      } catch {
        this.landmarker = await this.createWithDelegate(fileset, 'CPU');
        this.delegate = 'CPU';
      }
      this.segmentationOn = false;
      this.modelOn = 'full';
    } catch (err) {
      throw new VisionError(
        'POSE_INIT_FAILED',
        err instanceof Error ? err.message : 'Failed to initialize pose tracking.',
        err,
      );
    }
    if (this.segmentationWanted) await this.setSegmentationEnabled(true);
    // Not awaited: tracking starts on the full model while a heavier one downloads.
    if (this.modelWanted !== 'full') void this.setModelVariant(this.modelWanted);
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
      minPoseDetectionConfidence: VISION_CONFIG.mediapipe.minPoseDetectionConfidence,
      minPosePresenceConfidence: VISION_CONFIG.mediapipe.minPosePresenceConfidence,
      minTrackingConfidence: VISION_CONFIG.mediapipe.minTrackingConfidence,
    });
  }
}
