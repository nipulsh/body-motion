import { useEffect, useState, type RefObject } from 'react';
import { mapNormalizedToContainCanvas } from '@vision';
import { getTrackedHands } from '@vision/hand/handLandmarksBus';
import { INDEX_FINGER_TIP } from '@vision/hand/handPointer';

export interface TrailPoint {
  x: number;
  y: number;
}

const MAX_TRAIL_POINTS = 120;
const MIN_POINT_DISTANCE_PX = 4;

function appendTrail(trail: TrailPoint[], point: TrailPoint): TrailPoint[] {
  const last = trail[trail.length - 1];
  if (last) {
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (dx * dx + dy * dy < MIN_POINT_DISTANCE_PX * MIN_POINT_DISTANCE_PX) {
      return trail;
    }
  }
  const next = [...trail, point];
  if (next.length > MAX_TRAIL_POINTS) {
    return next.slice(next.length - MAX_TRAIL_POINTS);
  }
  return next;
}

/**
 * Index-fingertip trail for hand-trace exercises.
 * Reads the shared hand landmarks so it does not load a second HandLandmarker.
 * Points are mirrored so the trail sits on the flipped camera preview.
 */
export function useExerciseHandTrail(
  videoRef: RefObject<HTMLVideoElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): TrailPoint[] {
  const [trail, setTrail] = useState<TrailPoint[]>([]);

  useEffect(() => {
    if (!enabled) {
      setTrail([]);
      return;
    }

    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    let cancelled = false;
    let rafId = 0;

    const loop = () => {
      if (cancelled) return;
      const tip = getTrackedHands()[0]?.landmarks[INDEX_FINGER_TIP];
      const frameWidth = video.videoWidth;
      const frameHeight = video.videoHeight;
      const rect = overlay.getBoundingClientRect();

      if (tip && frameWidth > 0 && frameHeight > 0 && rect.width > 0 && rect.height > 0) {
        const mapped = mapNormalizedToContainCanvas(
          tip.x,
          tip.y,
          rect.width,
          rect.height,
          frameWidth,
          frameHeight,
          true,
        );
        setTrail((prev) => appendTrail(prev, mapped));
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      setTrail([]);
    };
  }, [enabled, overlayRef, videoRef]);

  return trail;
}
