import { useEffect, type RefObject } from 'react';
import { setTrackedHands } from '@vision/hand/handLandmarksBus';
import type { HandDetector } from '@vision/hand/HandDetector';
import {
  holdsHandProcessor,
  preemptHandProcessor,
  releaseHandProcessor,
  releaseSharedHandDetector,
  retainSharedHandDetector,
} from '@vision/hand/sharedHandDetector';

/**
 * Runs the shared HandLandmarker on this video, including the off-screen
 * exercise camera. Takes detection from mirror navigation so finger landmarks
 * use the same frame as the pose skeleton. A hand that is not detected is omitted.
 */
export function useWireframeHandTracking(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let rafId = 0;
    let token: symbol | null = null;
    let detector: HandDetector | null = null;
    let scratch: HTMLCanvasElement | null = null;

    const canvasCopy = (video: HTMLVideoElement): HTMLCanvasElement | null => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width < 2 || height < 2) return null;
      if (!scratch) scratch = document.createElement('canvas');
      if (scratch.width !== width) scratch.width = width;
      if (scratch.height !== height) scratch.height = height;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);
      return scratch;
    };

    const loop = () => {
      if (cancelled) return;
      try {
        if (detector) {
          // Menu navigation stays mounted during the exercise session and would
          // otherwise keep the only HandLandmarker on its own hidden video.
          if (!token || !holdsHandProcessor(token)) token = preemptHandProcessor();
          const video = videoRef.current;
          if (video && detector.isReady() && video.readyState >= 2) {
            const result = detector.processFrame(video, performance.now());
            let hands = result?.hands ?? null;
            if (!hands || hands.length === 0) {
              const copied = canvasCopy(video);
              if (copied) {
                const retry = detector.processFrame(copied, performance.now());
                if (retry && retry.hands.length > 0) hands = retry.hands;
              }
            }
            if (hands) setTrackedHands(hands);
          }
        }
      } catch {
        // Keep polling. One failed frame must not leave the fingers blank.
      }
      if (!cancelled) rafId = requestAnimationFrame(loop);
    };

    const start = () => {
      if (cancelled) return;
      if (!videoRef.current) {
        rafId = requestAnimationFrame(start);
        return;
      }
      token = preemptHandProcessor();
      detector = retainSharedHandDetector();
      void detector.initialize().then(() => {
        if (!cancelled && token) loop();
      }).catch(() => {
        if (token) {
          releaseHandProcessor(token);
          token = null;
        }
      });
    };

    start();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (token) {
        const held = holdsHandProcessor(token);
        releaseHandProcessor(token);
        if (held) setTrackedHands([]);
      }
      if (detector) releaseSharedHandDetector();
    };
  }, [enabled, videoRef]);
}
