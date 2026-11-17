import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseResult } from '@vision';
import { detectOneLegBalance, type OneLegBalanceResult } from '@vision/games/balanceDetection';
import {
  applyBalanceScore,
  createBalanceScoreState,
  type BalanceScoreState,
} from '@vision/games/balanceBirdScoring';
import {
  DEFAULT_BIRD_FLIGHT_CONFIG,
  maybeSpawnBird,
  resetBirdIds,
  tickBirds,
  type Bird,
} from '@vision/games/birdFlight';
import { drawBalanceBirdScene } from '@vision/games/drawGameScene';
import { mapPoseHipToCanvas } from '@vision/games/playerMarker';
import { usePlayerWalkAway } from './usePlayerWalkAway';
import { usePosePreviewCamera } from './usePosePreviewCamera';

/** `onPlayerLeft` runs once the player has stepped out of the mirror for good. */
export function useBalanceBirdGame({ onPlayerLeft }: { onPlayerLeft: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const birdsRef = useRef<Bird[]>([]);
  const lastSpawnRef = useRef(0);
  const poseRef = useRef<PoseResult | null>(null);
  const frameSizeRef = useRef<{ width: number; height: number } | null>(null);
  const scoreStateRef = useRef<BalanceScoreState>(createBalanceScoreState());
  const balanceRef = useRef<OneLegBalanceResult>({
    balanced: false,
    supportLeg: 'none',
    confidence: 0,
    detail: 'no_pose',
  });
  const pulseUntilRef = useRef(0);

  const [balance, setBalance] = useState<OneLegBalanceResult>(balanceRef.current);
  const [points, setPoints] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const { notePose, secondsLeft: leavingInSeconds } = usePlayerWalkAway(onPlayerLeft);

  const onPose = useCallback((pose: PoseResult | null, frame: { width: number; height: number } | null) => {
    notePose(pose);
    poseRef.current = pose;
    frameSizeRef.current = frame;
    const next = detectOneLegBalance(pose);
    const prev = balanceRef.current;
    if (
      prev.balanced !== next.balanced ||
      prev.supportLeg !== next.supportLeg ||
      prev.detail !== next.detail
    ) {
      balanceRef.current = next;
      setBalance(next);
    }

    const scored = applyBalanceScore(scoreStateRef.current, next.balanced);
    scoreStateRef.current = scored.state;
    if (scored.awarded) {
      setPoints(scored.state.points);
      pulseUntilRef.current = performance.now() + 450;
    }
  }, [notePose]);

  // Poses arrive upright for the portrait stage (the camera is turned on its side with the TV).
  const { error: poseError, turn: cameraTurn, pictureAspect } = usePosePreviewCamera(videoRef, onPose, true);

  useEffect(() => {
    setCameraError(poseError);
  }, [poseError]);

  useEffect(() => {
    resetBirdIds();
    birdsRef.current = [];
    scoreStateRef.current = createBalanceScoreState();
    setPoints(0);
    return () => {
      resetBirdIds();
      birdsRef.current = [];
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    let rafId = 0;
    let lastTs = performance.now();

    const frame = (now: number) => {
      const dt = now - lastTs;
      lastTs = now;
      // Layout size, not the bounding box: the kiosk shell rotates this element.
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const spawn = maybeSpawnBird(
        birdsRef.current,
        now,
        lastSpawnRef.current,
        width,
        height,
        DEFAULT_BIRD_FLIGHT_CONFIG,
      );
      birdsRef.current = tickBirds(spawn.birds, dt, width);
      lastSpawnRef.current = spawn.lastSpawnMs;

      const frameSize = frameSizeRef.current;
      const player = mapPoseHipToCanvas(
        poseRef.current,
        width,
        height,
        frameSize?.width ?? 0,
        frameSize?.height ?? 0,
        true,
        // Same fit as the video: full stage height, sides cropped when wider.
        'height',
      );

      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawBalanceBirdScene(
          ctx,
          birdsRef.current,
          player,
          balanceRef.current.balanced,
          now < pulseUntilRef.current,
        );
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return {
    videoRef,
    canvasRef,
    stageRef,
    balance,
    points,
    cameraError,
    leavingInSeconds,
    cameraTurn,
    pictureAspect,
  };
}
