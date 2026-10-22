import { useEffect, useRef, useState } from 'react';
import {
  getVisionManager,
  userMessageForVisionError,
  VisionError,
  type PoseResult,
} from '@vision';

export interface SmartMirrorPoseFrame {
  width: number;
  height: number;
}

export type SmartMirrorPoseListener = (
  pose: PoseResult | null,
  frame: SmartMirrorPoseFrame | null,
) => void;

const CAMERA_DISCONNECTED = 'The camera disconnected. Check the connection and reopen the mirror.';
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

/**
 * Starts the shared camera and pose preview, or listens to an existing
 * exercise pose stream when one is already running. Pose frames are delivered
 * through `onPose` and do not update React state.
 */
export function useSmartMirrorPose(onPose: SmartMirrorPoseListener): { error: string | null } {
  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const manager = getVisionManager();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('aria-hidden', 'true');

    let cancelled = false;
    let owned = false;
    let acquired = false;
    let failed = false;
    let starting = false;
    let previewStopped = false;
    let cameraStopped = false;
    let unwatch = () => {};

    const clearPose = () => onPoseRef.current(null, null);

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
      onPoseRef.current(
        frame.pose,
        frame.frameWidth > 0 && frame.frameHeight > 0
          ? { width: frame.frameWidth, height: frame.frameHeight }
          : null,
      );
    });

    const unsubscribeExercise = manager.subscribeExerciseFrame((payload) => {
      if (manager.isPosePreviewActive()) return;
      onPoseRef.current(payload.pose, manager.getVideoFrameSize());
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
        if (existing) watchStream(existing);
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
        } else {
          const stream = manager.getStream();
          if (stream && video.srcObject !== stream) {
            await manager.attachStreamToVideo(video, stream);
            if (cancelled) {
              releaseOwnedCamera();
              return;
            }
            watchStream(stream);
          }
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
      window.clearInterval(recover);
      unsubscribePreview();
      unsubscribeExercise();
      unwatch();
      releaseOwnedCamera();
      video.srcObject = null;
    };
  }, []);

  return { error };
}
