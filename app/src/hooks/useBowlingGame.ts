import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseResult } from '@vision';
import { hipMidpointNormalized } from '@vision/games/playerMarker';
import {
  nextBowlingRoll,
  PINS_PER_RACK,
  scoreBowlingGame,
  type BowlingGameScore,
} from '@vision/games/bowling/bowlingScoring';
import { createStanceTracker, updateStanceTracker } from '@vision/games/bowling/bowlingStance';
import { createSwingDetector, updateSwingDetector } from '@vision/games/bowling/bowlingSwing';
import {
  ballStartX,
  createThrowFlow,
  throwCue,
  updateThrowFlow,
  type ThrowCue,
} from '@vision/games/bowling/bowlingThrowFlow';
import { HEAD_PIN_Z } from '../games/bowling/bowlingDimensions';
import { laneXForStart, launchFromRelease } from '../games/bowling/bowlingLaunch';
import { BowlingPhysics } from '../games/bowling/bowlingPhysics';
import { BowlingScene } from '../games/bowling/bowlingScene';
import { usePlayerWalkAway } from './usePlayerWalkAway';
import { usePosePreviewCamera } from './usePosePreviewCamera';

export type BowlingGamePhase = 'loading' | 'aiming' | 'rolling' | 'result' | 'over';

/** Pins and ball must stay at rest this long before the result is read. */
const SETTLE_QUIET_MS = 500;
const MIN_ROLL_MS = 1500;
/** Safety nets for a roll that never settles (a pin rocking in the gutter). */
const ROLL_TIMEOUT_MS = 20000;
const AFTER_PINS_TIMEOUT_MS = 7000;
/** How long the camera holds on the pins before the next ball. */
const RESULT_HOLD_MS = 1600;

const SCENE_ERROR = 'The bowling lane could not start on this screen. Close the game and try again.';

function sameCue(a: ThrowCue | null, b: ThrowCue | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.text === b.text && a.tone === b.tone && a.progress === b.progress;
}

/** `onPlayerLeft` runs once the player has stepped out of the mirror for good. */
export function useBowlingGame({ onPlayerLeft }: { onPlayerLeft: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const physicsRef = useRef<BowlingPhysics | null>(null);
  const sceneRef = useRef<BowlingScene | null>(null);
  const phaseRef = useRef<BowlingGamePhase>('loading');
  const flowRef = useRef(createThrowFlow());
  const swingRef = useRef(createSwingDetector());
  const stanceRef = useRef(createStanceTracker());
  const rollsRef = useRef<number[]>([]);
  const standingBeforeRef = useRef(PINS_PER_RACK);
  const standingAfterRef = useRef<boolean[]>([]);
  const rollStartRef = useRef(0);
  const reachedPinsAtRef = useRef<number | null>(null);
  const quietSinceRef = useRef<number | null>(null);
  const resultUntilRef = useRef(0);
  const shownAimXRef = useRef(0);
  const cueRef = useRef<ThrowCue | null>(null);

  const [phase, setPhaseState] = useState<BowlingGamePhase>('loading');
  const [cue, setCue] = useState<ThrowCue | null>(null);
  const [finalScore, setFinalScore] = useState<BowlingGameScore | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const { notePose, secondsLeft: leavingInSeconds } = usePlayerWalkAway(onPlayerLeft);

  const setPhase = useCallback((next: BowlingGamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const publishCue = useCallback((t: number) => {
    let next = phaseRef.current === 'aiming' ? throwCue(flowRef.current, t) : null;
    if (next?.progress != null) next = { ...next, progress: Math.round(next.progress * 20) / 20 };
    if (!sameCue(cueRef.current, next)) {
      cueRef.current = next;
      setCue(next);
    }
  }, []);

  const onPose = useCallback(
    (pose: PoseResult | null) => {
      notePose(pose);
      const t = performance.now();
      const swing = updateSwingDetector(swingRef.current, pose, t);
      swingRef.current = swing.state;
      const stance = updateStanceTracker(stanceRef.current, pose, t);
      stanceRef.current = stance.state;

      const hip = hipMidpointNormalized(pose);
      const flow = updateThrowFlow(flowRef.current, {
        t,
        balance: stance.balance,
        // Mirror view: the player's own right is the screen's right.
        hipX: hip ? 1 - hip.x : null,
        release: swing.release,
        accepting: phaseRef.current === 'aiming',
      });
      flowRef.current = flow.state;

      const physics = physicsRef.current;
      if (flow.event?.type === 'throw' && physics && phaseRef.current === 'aiming') {
        physics.launch(launchFromRelease(flow.event.release, flow.event.startX));
        rollStartRef.current = t;
        reachedPinsAtRef.current = null;
        quietSinceRef.current = null;
        setPhase('rolling');
      }
      publishCue(t);
    },
    [notePose, publishCue, setPhase],
  );

  const { error: poseError } = usePosePreviewCamera(videoRef, onPose, true);

  useEffect(() => {
    setCameraError(poseError);
  }, [poseError]);

  /** Reads the pins once everything has stopped, and sets up the next ball. */
  const advanceGame = useCallback(
    (now: number, physics: BowlingPhysics) => {
      if (phaseRef.current === 'rolling') {
        const inPlay = physics.ballInPlay();
        if (reachedPinsAtRef.current === null && (!inPlay || physics.ballPose().z < HEAD_PIN_Z + 0.5)) {
          reachedPinsAtRef.current = now;
        }
        quietSinceRef.current = physics.isSettled() ? (quietSinceRef.current ?? now) : null;
        const elapsed = now - rollStartRef.current;
        const reachedAt = reachedPinsAtRef.current;
        const settled =
          elapsed > MIN_ROLL_MS &&
          reachedAt !== null &&
          quietSinceRef.current !== null &&
          now - quietSinceRef.current > SETTLE_QUIET_MS;
        const timedOut = elapsed > ROLL_TIMEOUT_MS || (reachedAt !== null && now - reachedAt > AFTER_PINS_TIMEOUT_MS);
        if (settled || timedOut) {
          const standing = physics.standingPins();
          const standingCount = standing.filter(Boolean).length;
          rollsRef.current = [...rollsRef.current, Math.max(0, standingBeforeRef.current - standingCount)];
          standingAfterRef.current = standing;
          resultUntilRef.current = now + RESULT_HOLD_MS;
          setPhase('result');
        }
        return;
      }

      if (phaseRef.current === 'result' && now >= resultUntilRef.current) {
        const next = nextBowlingRoll(rollsRef.current);
        physics.holdBall();
        if (next.done) {
          setFinalScore(scoreBowlingGame(rollsRef.current));
          setPhase('over');
          return;
        }
        if (next.freshRack) {
          physics.rackPins();
          standingBeforeRef.current = PINS_PER_RACK;
        } else {
          physics.respotStanding(standingAfterRef.current);
          standingBeforeRef.current = standingAfterRef.current.filter(Boolean).length;
        }
        setPhase('aiming');
        publishCue(now);
      }
    },
    [publishCue, setPhase],
  );

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    let cancelled = false;
    let rafId = 0;
    let lastTs = performance.now();
    let size = { w: 0, h: 0, dpr: 0 };

    const frame = (now: number) => {
      const physics = physicsRef.current;
      const scene = sceneRef.current;
      if (cancelled || !physics || !scene) return;
      const dt = Math.max(0, Math.min(0.1, (now - lastTs) / 1000));
      lastTs = now;

      // Layout size, not the bounding box: the kiosk shell rotates this element.
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (w !== size.w || h !== size.h || dpr !== size.dpr) {
        size = { w, h, dpr };
        scene.resize(w, h, dpr);
      }

      physics.step(dt);
      advanceGame(now, physics);

      const p = phaseRef.current;
      let aimBallX: number | null = null;
      if (p === 'aiming') {
        const target = laneXForStart(ballStartX(flowRef.current));
        shownAimXRef.current += (target - shownAimXRef.current) * (1 - Math.exp(-dt * 12));
        aimBallX = shownAimXRef.current;
      }
      scene.render(physics.snapshot(), aimBallX, p === 'rolling' || p === 'result' ? 'follow' : 'aim', dt);
      rafId = requestAnimationFrame(frame);
    };

    void (async () => {
      let scene: BowlingScene | null = null;
      try {
        scene = new BowlingScene(canvas);
        const physics = await BowlingPhysics.create();
        if (cancelled) {
          physics.dispose();
          scene.dispose();
          return;
        }
        physicsRef.current = physics;
        sceneRef.current = scene;
        setPhase('aiming');
        publishCue(performance.now());
        lastTs = performance.now();
        rafId = requestAnimationFrame(frame);
      } catch {
        scene?.dispose();
        if (!cancelled) setSceneError(SCENE_ERROR);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      physicsRef.current?.dispose();
      sceneRef.current?.dispose();
      physicsRef.current = null;
      sceneRef.current = null;
      phaseRef.current = 'loading';
    };
  }, [advanceGame, publishCue, setPhase]);

  const playAgain = useCallback(() => {
    const physics = physicsRef.current;
    if (!physics) return;
    rollsRef.current = [];
    standingBeforeRef.current = PINS_PER_RACK;
    standingAfterRef.current = [];
    flowRef.current = createThrowFlow();
    swingRef.current = createSwingDetector();
    stanceRef.current = createStanceTracker();
    physics.holdBall();
    physics.rackPins();
    setFinalScore(null);
    setPhase('aiming');
    publishCue(performance.now());
  }, [publishCue, setPhase]);

  return {
    videoRef,
    canvasRef,
    stageRef,
    phase,
    cue,
    finalScore,
    cameraError,
    sceneError,
    playAgain,
    leavingInSeconds,
  };
}
