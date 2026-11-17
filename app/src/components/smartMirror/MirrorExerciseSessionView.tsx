import { useCallback, useRef, useState, type RefObject } from 'react';
import { useMirrorGeometry } from '../../hooks/useMirrorGeometry';
import {
  eyeAtDistance,
  eyeDisplacementPx,
  withoutRise,
  type MirrorPoint,
  type MirrorViewer,
} from '@vision/pose/mirrorReflection';
import { bodyUpOnScreen } from '@vision/pose/wireframeTracking';
import type { Point2D } from '@vision/pose/wireframe';
import { cn } from '@/lib/utils';
import type { Exercise } from '@vision';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { PATIENT_POSITIONING_STEPS } from '../../exercise/calibration/cameraPositioning';
import { formatCountdownLabel, type CountdownStep } from '../../exercise/sessionState';
import { PoseWireframeOverlay, type PoseWireframeFrameSize } from '../vision/PoseWireframeOverlay';
import { formScoresReps, type ExerciseFormResult, type PoseResult, type RangeSetSummary } from '@vision';
import type { ExerciseDemoVideoLoadState } from '../../hooks/useExerciseDemoVideo';
import { mirrorGestureButtonClass } from './mirrorGestureButton';
import { MirrorPortraitCard } from './MirrorPortraitCard';
import { mirrorTopZoneOverlayClass } from './mirrorTopZone';
import { Button } from '../ui/button';

export interface MirrorExerciseSessionViewProps {
  exercise: Exercise;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraStageRef: RefObject<HTMLDivElement | null>;
  pose: PoseResult | null;
  form?: ExerciseFormResult | null;
  /** Held form correction, already worded for the patient. */
  formCorrection?: string | null;
  videoFrameSize: PoseWireframeFrameSize | null;
  isHandTrace: boolean;
  repCount: number;
  targetReps: number;
  countdownStep: CountdownStep;
  /** Squat or lunge model: replaces the countdown while the patient faces the wrong way. */
  countdownPrompt?: string | null;
  /** Squat or lunge model: correct, borderline and incorrect reps so far this set. */
  rangeQuality?: Pick<RangeSetSummary, 'correct' | 'borderline' | 'incorrect'> | null;
  /** Squat or lunge model: the last rep's outcome, until the next one. */
  rangeStatus?: { text: string; tone: 'good' | 'borderline' | 'incorrect' } | null;
  paused: boolean;
  showCountdownOverlay: boolean;
  /** Still supplied by the session. The demonstration clip is not shown. */
  demoVideoUrl: string | null | undefined;
  demoVideoLoadState: ExerciseDemoVideoLoadState;
  demoVideoError: string | null;
  onRetryDemoVideo: () => void;
  cameraError: string | null;
  onExit: () => void;
}

export function MirrorExerciseSessionView({
  videoRef,
  cameraStageRef,
  pose,
  form = null,
  formCorrection = null,
  videoFrameSize,
  isHandTrace,
  repCount,
  targetReps,
  countdownStep,
  countdownPrompt = null,
  rangeQuality = null,
  rangeStatus = null,
  paused,
  showCountdownOverlay,
  cameraError,
  onExit,
}: MirrorExerciseSessionViewProps) {
  const mirrorGeometry = useMirrorGeometry();
  const [eyeVideoOffsetPx, setEyeVideoOffsetPx] = useState({ x: 0, y: 0 });

  /**
   * Where the eyes were when they were first detected, and how far from the glass: the video's
   * starting point, where the patient stands.
   */
  const startEyeRef = useRef<{ eye: MirrorPoint; distanceIn: number } | null>(null);
  /** The way the body points on screen, last time it was seen. */
  const bodyUpRef = useRef<Point2D | null>(null);
  const latestPoseRef = useRef({ pose, videoFrameSize });
  latestPoseRef.current = { pose, videoFrameSize };

  const followEyesForVideo = useCallback(
    (viewer: MirrorViewer | null) => {
      if (!viewer?.eyeDetected) {
        startEyeRef.current = null;
        bodyUpRef.current = null;
        setEyeVideoOffsetPx({ x: 0, y: 0 });
        return;
      }
      startEyeRef.current ??= { eye: { ...viewer.eye }, distanceIn: viewer.distanceIn };
      const latest = latestPoseRef.current;
      bodyUpRef.current = bodyUpOnScreen(latest.pose?.landmarks, latest.videoFrameSize, true) ?? bodyUpRef.current;
      const start = startEyeRef.current;
      const stage = cameraStageRef.current;
      // Both eye positions at today's distance: the distance reading settles slowly after a squat,
      // and must not read as the eyes moving.
      const offset = eyeDisplacementPx(
        viewer.eye,
        eyeAtDistance(start.eye, start.distanceIn, viewer.distanceIn, mirrorGeometry),
        mirrorGeometry,
        stage?.clientWidth ?? 0,
        stage?.clientHeight ?? 0,
      );
      // The picture follows the patient down into a squat, but never lifts above where it sits
      // when they stand: rising fast must not carry the wireframe off the top of the screen.
      setEyeVideoOffsetPx(withoutRise(offset, bodyUpRef.current));
    },
    [cameraStageRef, mirrorGeometry],
  );

  // Margins move the container; they never resize it, so the video keeps its size.
  // They are in the directions seen on the portrait TV. The page sits on the rotated
  // portrait stage, but the camera box below turns back a quarter, so inside it the
  // camera picture is unrotated, exactly as on the old flat page: the TV's down is the
  // box's +x and the TV's right is the box's -y.
  const screenShiftRight = mirrorGeometry.videoMarginLeftPx - mirrorGeometry.videoMarginRightPx;
  const screenShiftDown = mirrorGeometry.videoMarginTopPx - mirrorGeometry.videoMarginBottomPx;
  const marginShiftX = screenShiftDown;
  const marginShiftY = -screenShiftRight;

  return (
    <MirrorPortraitCard testId="mirror-exercise-card" className="overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div
          data-testid="mirror-exercise-stage"
          className="relative min-h-0 flex-1 overflow-hidden bg-black [container-type:size]"
        >
          {/*
            The camera is turned on its side with the TV, so its raw picture already looks upright
            on the TV when it is not rotated. The stage is rotated 90° left; this landscape box turns
            90° right inside it, so the video, the wireframe and the mirror calibration behave as
            they did on the flat page, while everything else on this page reads upright.
          */}
          <div
            ref={cameraStageRef}
            data-testid="mirror-exercise-camera-turn"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[100cqw] w-[100cqh] -translate-x-1/2 -translate-y-1/2 rotate-90"
          >
            <div
              data-testid="mirror-exercise-video-container"
              className="pointer-events-none absolute inset-0"
              style={{
                transform: `translate(${eyeVideoOffsetPx.x + marginShiftX}px, ${eyeVideoOffsetPx.y + marginShiftY}px) scale(${mirrorGeometry.videoZoom})`,
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                data-testid="mirror-exercise-camera"
                className="mirror-video pointer-events-none absolute inset-0 h-full w-full object-contain"
                // Hidden, not unmounted: the camera must keep running for pose tracking.
                style={{ opacity: mirrorGeometry.showVideo ? 1 : 0 }}
              />
              <PoseWireframeOverlay
                pose={pose}
                sourceFrame={videoFrameSize}
                mirrorX
                mirrorGeometry={mirrorGeometry}
                matchVideo
                form={form}
                onViewer={followEyesForVideo}
                lineWidth={3}
                jointRadius={4}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </div>
          </div>

          <div
            data-testid="mirror-exercise-rep-count"
            className="absolute left-3 top-3 z-20 min-w-[3.25rem] rounded-lg border border-white/50 bg-black/75 px-2.5 py-1.5 text-center"
          >
            {isHandTrace ? (
              <span className="text-xs font-medium text-white">Trace</span>
            ) : (
              <span className="text-lg font-semibold tabular-nums text-white">
                {repCount}
                <span className="text-xs text-white/70">/{targetReps}</span>
              </span>
            )}
            {rangeQuality ? (
              <div data-testid="mirror-exercise-rep-quality" className="mt-1 flex gap-1 text-[0.65rem] font-semibold tabular-nums">
                <span className="rounded bg-emerald-500/90 px-1 text-white">{rangeQuality.correct}</span>
                <span className="rounded bg-amber-500/90 px-1 text-white">{rangeQuality.borderline}</span>
                <span className="rounded bg-red-500/90 px-1 text-white">{rangeQuality.incorrect}</span>
              </div>
            ) : form && formScoresReps(form) ? (
              <div data-testid="mirror-exercise-rep-quality" className="mt-1 flex gap-1 text-[0.65rem] font-semibold tabular-nums">
                <span className="rounded bg-emerald-500/90 px-1 text-white">{form.correctReps}</span>
                <span className="rounded bg-red-500/90 px-1 text-white">{form.incorrectReps}</span>
              </div>
            ) : null}
          </div>

          {/* Below the counter and Exit, still in the top 40% of the screen. */}
          {formCorrection ? (
            <p
              data-testid="mirror-exercise-form-correction"
              className="absolute left-3 right-3 top-28 z-20 rounded-lg bg-red-600/85 px-3 py-2 text-center text-xs font-semibold text-white sm:top-32"
              role="status"
            >
              {formCorrection}
            </p>
          ) : rangeStatus ? (
            <p
              data-testid="mirror-exercise-range-status"
              className={cn(
                'absolute left-3 right-3 top-28 z-20 rounded-lg px-3 py-2 text-center text-xs font-semibold text-white sm:top-32',
                rangeStatus.tone === 'good' && 'bg-emerald-600/85',
                rangeStatus.tone === 'borderline' && 'bg-amber-500/90',
                rangeStatus.tone === 'incorrect' && 'bg-red-600/85',
              )}
              role="status"
            >
              {rangeStatus.text}
            </p>
          ) : null}

          {showCountdownOverlay ? (
            <div className="absolute inset-0 z-30 bg-black/60">
              <div className={cn(mirrorTopZoneOverlayClass, 'px-4 text-center')}>
                <p className="text-4xl font-semibold uppercase tracking-[0.15em] text-white">
                  {countdownPrompt ? 'Turn' : formatCountdownLabel(countdownStep)}
                </p>
                <p
                  data-testid={countdownPrompt ? 'mirror-exercise-view-prompt' : undefined}
                  className="mt-4 max-w-[14rem] text-xs leading-relaxed text-white/80"
                >
                  {countdownPrompt ?? PATIENT_POSITIONING_STEPS[0]}
                </p>
              </div>
            </div>
          ) : null}

          {paused ? (
            <div className="absolute inset-0 z-30 bg-black/50">
              <div className={mirrorTopZoneOverlayClass}>
                <p className="text-2xl font-semibold uppercase tracking-[0.2em] text-white">Paused</p>
              </div>
            </div>
          ) : null}

          {cameraError ? (
            <p className="absolute left-3 right-3 top-[30%] z-30 text-center text-xs text-amber-200" role="alert">
              {cameraError}
            </p>
          ) : null}

          {/* The button itself is absolute: it takes only its own corner, never a row across the picture. */}
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-exercise-exit"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorGestureButtonClass, 'absolute right-3 top-3 z-40')}
            onClick={onExit}
          >
            Exit
          </Button>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
