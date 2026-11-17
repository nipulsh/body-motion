import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  getVisionManager,
  userMessageForVisionError,
  VisionError,
  type PoseResult,
} from '@vision';
import {
  CameraTurnTracker,
  turnFrameSize,
  turnPose,
  type CameraTurn,
} from '@vision/pose/uprightPose';
import {
  gameCalculationsReadyNow,
  orientationFromFrame,
  setGameVideoOrientation,
  subscribeKioskRotation,
} from '../games/gameVideoOrientation';
import { loadKioskCameraTurn, saveKioskCameraTurn } from '../games/kioskCameraTurn';

export interface PosePreviewFrameSize {
  width: number;
  height: number;
}

export type PosePreviewCameraListener = (
  pose: PoseResult | null,
  frame: PosePreviewFrameSize | null,
) => void;

const CAMERA_DISCONNECTED = 'The camera disconnected. Check the connection and try again.';
const PREVIEW_RECOVER_MS = 500;

function visionErrorMessage(err: unknown): string {
  if (err instanceof VisionError) return userMessageForVisionError(err.code);
  return userMessageForVisionError('CAMERA_UNKNOWN');
}

function watchVideoTracks(stream: MediaStream, onEnded: () => void): () => void {
  const tracks = stream.getVideoTracks();
  for (const track of tracks) track.addEventListener('ended', onEnded);
  return () => {
    for (const track of tracks) track.removeEventListener('ended', onEnded);
  };
}

export interface PosePreviewCamera {
  error: string | null;
  /** Clockwise turn applied to the raw camera picture so the patient stands upright. */
  turn: CameraTurn;
  /** Width / height of the upright picture the poses describe; null before the first frame. */
  pictureAspect: number | null;
}

/**
 * Shared-camera pose preview for the games on the portrait stage.
 *
 * The kiosk camera is turned on its side with the TV, so every pose (and its frame size)
 * is turned upright first: games see the patient standing in a tall picture, as a camera
 * on its end would. The turn is read from the body and remembered per kiosk.
 */
export function usePosePreviewCamera(
  videoRef: RefObject<HTMLVideoElement | null>,
  onPose: PosePreviewCameraListener,
  enabled: boolean,
): PosePreviewCamera {
  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;
  const [error, setError] = useState<string | null>(null);
  const [turn, setTurn] = useState<CameraTurn>(loadKioskCameraTurn);
  const [pictureAspect, setPictureAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setError(null);
      onPoseRef.current(null, null);
      setGameVideoOrientation('unknown');
      return;
    }

    const manager = getVisionManager();
    const video = videoRef.current;
    if (!video) {
      setError('Camera preview is not ready.');
      setGameVideoOrientation('unknown');
      return;
    }

    const noteFrame = (frame: PosePreviewFrameSize | null) => {
      if (!frame || frame.width <= 0 || frame.height <= 0) return;
      setGameVideoOrientation(orientationFromFrame(frame.width, frame.height));
    };

    const tracker = new CameraTurnTracker(loadKioskCameraTurn());
    let shownTurn: CameraTurn | null = null;
    let savedTurn: CameraTurn | null = null;
    let shownAspect: number | null = null;

    const standUp = (pose: PoseResult | null, size: PosePreviewFrameSize | null) => {
      const current = size
        ? tracker.update(pose?.landmarks ?? null, size, pose?.timestamp ?? performance.now())
        : tracker.turn;
      if (current !== shownTurn) {
        shownTurn = current;
        setTurn(current);
      }
      if (tracker.locked && current !== savedTurn) {
        savedTurn = current;
        saveKioskCameraTurn(current);
      }
      const uprightSize = size ? turnFrameSize(size, current) : null;
      const aspect = uprightSize && uprightSize.height > 0 ? uprightSize.width / uprightSize.height : null;
      if (aspect !== null && aspect !== shownAspect) {
        shownAspect = aspect;
        setPictureAspect(aspect);
      }
      return { pose: pose ? turnPose(pose, current) : null, size: uprightSize };
    };

    let cancelled = false;
    let latest: { pose: PoseResult | null; size: PosePreviewFrameSize | null } | null = null;
    let flushScheduled = false;
    let flushRaf = 0;

    const deliverLatest = () => {
      if (cancelled || !latest || !gameCalculationsReadyNow()) return;
      onPoseRef.current(latest.pose, latest.size);
    };

    // Rotation commits in layout, then the stage is measured. Pose math runs on the next frame.
    const scheduleFlush = () => {
      if (flushScheduled || cancelled) return;
      flushScheduled = true;
      flushRaf = requestAnimationFrame(() => {
        flushRaf = 0;
        flushScheduled = false;
        deliverLatest();
      });
    };

    const publish = (rawPose: PoseResult | null, rawSize: PosePreviewFrameSize | null) => {
      const { pose, size } = standUp(rawPose, rawSize);
      noteFrame(size);
      latest = { pose, size };
      if (flushScheduled || cancelled) return;
      if (!gameCalculationsReadyNow()) return;
      deliverLatest();
    };

    const unsubscribeRotation = subscribeKioskRotation(() => {
      if (!latest || !gameCalculationsReadyNow()) return;
      scheduleFlush();
    });
    let owned = false;
    let acquired = false;
    let failed = false;
    let starting = false;
    let previewStopped = false;
    let cameraStopped = false;
    let unwatch = () => {};

    const clearPose = () => {
      latest = null;
      onPoseRef.current(null, null);
    };

    const releaseOwnedCamera = () => {
      if (!owned) return;
      if (!previewStopped) {
        previewStopped = true;
        manager.stopPosePreview();
        manager.detachVideoIfCurrent(video);
      }
      if (acquired && !cameraStopped) {
        cameraStopped = true;
        manager.stopCamera();
      }
    };

    const unsubscribePreview = manager.subscribePosePreview((frame) => {
      const size =
        frame.frameWidth > 0 && frame.frameHeight > 0
          ? { width: frame.frameWidth, height: frame.frameHeight }
          : null;
      publish(frame.pose, size);
    });

    const unsubscribeExercise = manager.subscribeExerciseFrame((payload) => {
      if (manager.isPosePreviewActive()) return;
      publish(payload.pose, manager.getVideoFrameSize());
    });

    const fail = (message: string) => {
      if (cancelled) return;
      clearPose();
      setError(message);
    };

    const watchStream = (stream: MediaStream) => {
      unwatch();
      unwatch = watchVideoTracks(stream, () => {
        failed = true;
        fail(CAMERA_DISCONNECTED);
      });
    };

    const ensurePreview = async () => {
      if (cancelled || failed || starting) return;
      if (!manager.canOwnPosePreview()) {
        const existing = manager.getStream();
        if (existing) {
          manager.attachVideo(video);
          await manager.attachStreamToVideo(video, existing);
          watchStream(existing);
        }
        return;
      }
      if (manager.isPosePreviewActive()) return;

      starting = true;
      try {
        owned = true;
        manager.attachVideo(video);
        if (!acquired) {
          const stream = await manager.startCamera(null);
          acquired = true;
          if (cancelled) {
            releaseOwnedCamera();
            return;
          }
          await manager.attachStreamToVideo(video, stream);
          if (cancelled) {
            releaseOwnedCamera();
            return;
          }
          watchStream(stream);
        }
        if (cancelled || failed || !manager.canOwnPosePreview() || manager.isPosePreviewActive()) {
          if (cancelled) releaseOwnedCamera();
          return;
        }
        await manager.startPosePreview();
        if (cancelled) releaseOwnedCamera();
      } catch (err) {
        failed = true;
        releaseOwnedCamera();
        fail(visionErrorMessage(err));
      } finally {
        starting = false;
      }
    };

    void ensurePreview();
    const recover = window.setInterval(() => {
      void ensurePreview();
    }, PREVIEW_RECOVER_MS);

    return () => {
      cancelled = true;
      if (flushRaf) cancelAnimationFrame(flushRaf);
      window.clearInterval(recover);
      unsubscribeRotation();
      unsubscribePreview();
      unsubscribeExercise();
      unwatch();
      releaseOwnedCamera();
      if (video.srcObject) video.srcObject = null;
      setGameVideoOrientation('unknown');
    };
  }, [enabled, videoRef]);

  return { error, turn, pictureAspect };
}
