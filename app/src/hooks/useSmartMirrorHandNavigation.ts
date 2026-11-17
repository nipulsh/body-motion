import { useEffect, useRef, useState } from 'react';
import { getVisionManager, userMessageForVisionError, VisionError } from '@vision';
import { getTrackedHands, setTrackedHands } from '@vision/hand/handLandmarksBus';
import {
  claimHandProcessor,
  holdsHandProcessor,
  releaseHandProcessor,
  releaseSharedHandDetector,
  retainSharedHandDetector,
} from '@vision/hand/sharedHandDetector';
import {
  clearMirrorGestureHover,
  findMirrorGestureTargetAt,
  syncMirrorGestureHover,
} from '@vision/hand/gestureTargets';
import { HandVideoReader, keepVideoPlaying } from '@vision/hand/handVideoReader';
import { FistClickGate, isFistGesture, PrimaryHandTracker } from '@vision/hand/fistGesture';
import { handPointToViewport, palmCenter } from '@vision/hand/handPointer';
import { PinchManipulator, pinchDragToViewport } from '@vision/hand/pinchGesture';
import { getMirrorModelControl } from '../bodyExplorer/mirrorModelControl';
import {
  applyPinchDrag,
  findPinchDragTarget,
  type PinchDragTarget,
} from '../components/smartMirror/pinchDragTarget';

export interface MirrorHandPointer {
  x: number;
  y: number;
  visible: boolean;
  /** True when the pointer sits over an enabled fist-selectable button. */
  overTarget: boolean;
}

export interface UseSmartMirrorHandNavigationResult {
  pointer: MirrorHandPointer | null;
  status: 'idle' | 'starting' | 'ready' | 'error';
  error: string | null;
}

const CAMERA_START_ATTEMPTS = 12;
const CAMERA_RETRY_MS = 450;
const ERROR_RECOVERY_MS = 3000;
/** 1 follows the palm instantly; lower values damp jitter from the extra gain. */
const POINTER_FOLLOW = 0.58;
/** A hand missing this long was lowered, which re-arms fist clicks; shorter gaps are tracking dropouts. */
const NO_HAND_REARM_MS = 500;

/** Off-screen but full resolution so decoders and MediaPipe receive real frames. */
const HIDDEN_VIDEO_CLASS =
  'pointer-events-none fixed -left-[9999px] top-0 h-[480px] w-[640px] opacity-0';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function messageForHandNavError(err: unknown): string {
  if (err instanceof VisionError) return userMessageForVisionError(err.code);
  if (err instanceof Error) return err.message;
  return 'Hand tracking could not start.';
}

function isRetryableCameraError(err: unknown): boolean {
  if (err instanceof VisionError) {
    return err.code === 'CAMERA_NOT_READABLE' || err.code === 'CAMERA_UNKNOWN';
  }
  return false;
}

async function waitForVideoFrames(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Camera preview did not start.'));
    }, 8000);
    const onReady = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('playing', onReady);
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('playing', onReady);
    onReady();
  });
}

const POST_RESET_SETTLE_MS = 350;

/**
 * Shared-camera hand navigation for mirror menus.
 * Uses VisionManager retain/release; does not start pose preview or a second stream.
 *
 * During the live mirror exercise session, `landmarksFromExerciseBus` reads hands
 * from `useWireframeHandTracking` instead of competing for the HandLandmarker or
 * rebinding the shared camera to a hidden video element.
 */
export function useSmartMirrorHandNavigation(
  rootElement: HTMLElement | null,
  enabled = true,
  hardResetGeneration = 0,
  landmarksFromExerciseBus = false,
): UseSmartMirrorHandNavigationResult {
  const [pointer, setPointer] = useState<MirrorHandPointer | null>(null);
  const [status, setStatus] = useState<UseSmartMirrorHandNavigationResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);
  const fistGateRef = useRef(new FistClickGate());
  const primaryHandRef = useRef(new PrimaryHandTracker());
  const pinchRef = useRef(new PinchManipulator());
  const dragTargetRef = useRef<PinchDragTarget | null>(null);
  const pinchLockedRef = useRef(false);
  const consumedHardResetGenerationRef = useRef(0);
  const smoothedPointerRef = useRef<{ x: number; y: number } | null>(null);
  const noHandSinceRef = useRef<number | null>(null);
  const handHoverTargetRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!enabled || !rootElement) {
      smoothedPointerRef.current = null;
      setPointer(null);
      setStatus('idle');
      setError(null);
      return;
    }

    const root = rootElement;
    const manager = getVisionManager();
    const busOnly = landmarksFromExerciseBus;
    const detector = busOnly ? null : retainSharedHandDetector();
    const reader = busOnly ? null : new HandVideoReader();
    let processorToken: symbol | null = null;
    const video = busOnly ? null : document.createElement('video');
    if (video) {
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('aria-hidden', 'true');
      video.className = HIDDEN_VIDEO_CLASS;
      root.appendChild(video);
    }

    let cancelled = false;
    let rafId = 0;
    let ownedCamera = false;
    let recoveryTimer = 0;

    const releaseCameraBinding = () => {
      if (!video) return;
      if (ownedCamera) {
        manager.stopCamera();
        ownedCamera = false;
      }
      manager.detachVideoIfCurrent(video);
      video.srcObject = null;
    };

    const fail = (message: string) => {
      if (cancelled) return;
      setStatus('error');
      setError(message);
      setPointer(null);
      recoveryTimer = window.setTimeout(() => {
        if (!cancelled) setRecoveryGeneration((value) => value + 1);
      }, ERROR_RECOVERY_MS);
    };

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(() => {
        void loop().finally(() => {
          if (!cancelled) tick();
        });
      });
    };

    const processHands = (
      hands: readonly { landmarks: readonly { x: number; y: number }[] }[],
      now: number,
    ) => {
      const landmarks = primaryHandRef.current.select(hands);
      if (!landmarks?.length) {
        pinchRef.current.reset();
        dragTargetRef.current = null;
        pinchLockedRef.current = false;
        smoothedPointerRef.current = null;
        noHandSinceRef.current ??= now;
        if (now - noHandSinceRef.current >= NO_HAND_REARM_MS) {
          fistGateRef.current.update(false, now);
        }
        clearMirrorGestureHover(root);
        handHoverTargetRef.current = null;
        setPointer(null);
        return;
      }
      noHandSinceRef.current = null;

      const palm = palmCenter(landmarks);
      if (!palm) {
        pinchRef.current.reset();
        dragTargetRef.current = null;
        pinchLockedRef.current = false;
        clearMirrorGestureHover(root);
        handHoverTargetRef.current = null;
        smoothedPointerRef.current = null;
        setPointer(null);
        return;
      }

      const fist = isFistGesture(landmarks);
      // Drops the last pinch palm so the next pinch does not jump by the movement made during the fist.
      if (fist) pinchRef.current.reset();
      const frame = fist ? { pinching: false, palm: null, drag: null, zoom: null } : pinchRef.current.update(hands);
      const aim = frame.pinching && frame.palm ? frame.palm : palm;
      const mapped = handPointToViewport(aim, window.innerWidth, window.innerHeight, {
        mirrorX: true,
      });
      const previous = smoothedPointerRef.current;
      const pointer = previous
        ? {
            x: previous.x + (mapped.x - previous.x) * POINTER_FOLLOW,
            y: previous.y + (mapped.y - previous.y) * POINTER_FOLLOW,
          }
        : mapped;
      smoothedPointerRef.current = pointer;

      const hovered = syncMirrorGestureHover(root, pointer.x, pointer.y, handHoverTargetRef.current);
      handHoverTargetRef.current = hovered;
      setPointer({ x: pointer.x, y: pointer.y, visible: true, overTarget: hovered != null });

      if (!frame.pinching) {
        pinchLockedRef.current = false;
        dragTargetRef.current = null;
      } else if (!pinchLockedRef.current && frame.palm) {
        pinchLockedRef.current = true;
        const at = handPointToViewport(frame.palm, window.innerWidth, window.innerHeight, {
          mirrorX: true,
        });
        dragTargetRef.current = findPinchDragTarget(root, at.x, at.y);
      }

      if (frame.drag && dragTargetRef.current) {
        const delta = pinchDragToViewport(frame.drag, window.innerWidth, window.innerHeight);
        applyPinchDrag(dragTargetRef.current, delta, getMirrorModelControl());
      }
      if (frame.zoom != null) {
        getMirrorModelControl()?.zoomBy(frame.zoom);
      }

      if (fist && fistGateRef.current.update(true, now)) {
        const target = findMirrorGestureTargetAt(root, pointer.x, pointer.y);
        target?.click();
      } else if (!fist) {
        fistGateRef.current.update(false, now);
      }
    };

    const loop = async () => {
      const now = performance.now();
      if (busOnly) {
        processHands(getTrackedHands(), now);
        return;
      }
      if (!detector?.isReady() || !video || !reader) return;
      if (processorToken && !holdsHandProcessor(processorToken)) processorToken = null;
      if (!processorToken) processorToken = claimHandProcessor();
      let hands: readonly { landmarks: readonly { x: number; y: number }[] }[] = [];
      if (processorToken && holdsHandProcessor(processorToken)) {
        keepVideoPlaying(video);
        const result = video.readyState >= 2 ? reader.read(detector, video, now) : null;
        // An unreadable frame is not a lost hand. Keep the pointer and the fist streak.
        if (!result) return;
        if (holdsHandProcessor(processorToken)) setTrackedHands(result.hands);
        hands = result.hands;
      } else {
        hands = getTrackedHands();
      }
      processHands(hands, now);
    };

    const tryAcquireCamera = async (): Promise<boolean> => {
      if (!video) return false;
      releaseCameraBinding();
      ownedCamera = false;

      if (!manager.canOwnPosePreview()) {
        const stream = manager.getStream();
        if (!stream) {
          return false;
        }
        manager.attachVideo(video);
        await manager.attachStreamToVideo(video, stream);
        await waitForVideoFrames(video);
        return true;
      }

      ownedCamera = true;
      manager.attachVideo(video);
      const stream = await manager.startCamera(null);
      await manager.attachStreamToVideo(video, stream);
      await waitForVideoFrames(video);
      return true;
    };

    const start = async () => {
      setStatus('starting');
      setError(null);
      if (busOnly) {
        setStatus('ready');
        tick();
        return;
      }
      if (hardResetGeneration > consumedHardResetGenerationRef.current) {
        manager.resetCameraSession();
        consumedHardResetGenerationRef.current = hardResetGeneration;
        await sleep(POST_RESET_SETTLE_MS);
      }

      for (let attempt = 0; attempt < CAMERA_START_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        try {
          const acquired = await tryAcquireCamera();
          if (!acquired) {
            if (attempt < CAMERA_START_ATTEMPTS - 1) {
              await sleep(CAMERA_RETRY_MS);
              continue;
            }
            fail('Camera is in use by another session.');
            return;
          }

          if (cancelled) return;
          await detector!.initialize();
          if (cancelled) return;
          setStatus('ready');
          tick();
          return;
        } catch (err) {
          releaseCameraBinding();

          if (cancelled) return;
          if (isRetryableCameraError(err) && attempt < CAMERA_START_ATTEMPTS - 1) {
            await sleep(CAMERA_RETRY_MS);
            continue;
          }
          fail(messageForHandNavError(err));
          return;
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      if (rafId) cancelAnimationFrame(rafId);
      fistGateRef.current.reset();
      primaryHandRef.current.reset();
      pinchRef.current.reset();
      dragTargetRef.current = null;
      pinchLockedRef.current = false;
      smoothedPointerRef.current = null;
      clearMirrorGestureHover(root);
      handHoverTargetRef.current = null;
      if (processorToken) {
        const held = holdsHandProcessor(processorToken);
        releaseHandProcessor(processorToken);
        processorToken = null;
        if (held) setTrackedHands([]);
      }
      if (detector) releaseSharedHandDetector();
      releaseCameraBinding();
      video?.remove();
      setPointer(null);
      setStatus('idle');
      setError(null);
    };
  }, [enabled, hardResetGeneration, landmarksFromExerciseBus, rootElement, recoveryGeneration]);

  return { pointer, status, error };
}
