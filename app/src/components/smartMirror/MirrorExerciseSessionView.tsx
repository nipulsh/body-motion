import type { RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { Exercise } from '@vision';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { PATIENT_POSITIONING_STEPS } from '../../exercise/calibration/cameraPositioning';
import { formatCountdownLabel, type CountdownStep } from '../../exercise/sessionState';
import { FingertipTrailOverlay } from '../vision/FingertipTrailOverlay';
import { PoseWireframeOverlay, type PoseWireframeFrameSize } from '../vision/PoseWireframeOverlay';
import type { PoseResult } from '@vision';
import type { TrailPoint } from '../../hooks/useExerciseHandTrail';
import type { ExerciseDemoVideoLoadState } from '../../hooks/useExerciseDemoVideo';
import { MirrorPortraitCard } from './MirrorPortraitCard';
import { Button } from '../ui/button';

const mirrorControlButtonClass =
  'h-auto min-h-8 rounded-lg border border-black bg-white px-3 py-1 text-xs font-medium text-black shadow-none hover:bg-neutral-50';

export interface MirrorExerciseSessionViewProps {
  exercise: Exercise;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraStageRef: RefObject<HTMLDivElement | null>;
  pose: PoseResult | null;
  videoFrameSize: PoseWireframeFrameSize | null;
  fingerTrail: TrailPoint[];
  isHandTrace: boolean;
  repCount: number;
  targetReps: number;
  countdownStep: CountdownStep;
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
  videoFrameSize,
  fingerTrail,
  isHandTrace,
  repCount,
  targetReps,
  countdownStep,
  paused,
  showCountdownOverlay,
  cameraError,
  onExit,
}: MirrorExerciseSessionViewProps) {
  return (
    <MirrorPortraitCard testId="mirror-exercise-card" className="overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div
          ref={cameraStageRef}
          data-testid="mirror-exercise-stage"
          className="relative min-h-0 flex-1 overflow-hidden bg-black"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            data-testid="mirror-exercise-camera"
            className="mirror-video pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
          <PoseWireframeOverlay
            pose={pose}
            sourceFrame={videoFrameSize}
            mirrorX
            lineWidth={3}
            jointRadius={4}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
          {isHandTrace ? <FingertipTrailOverlay trail={fingerTrail} /> : null}

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
          </div>

          {showCountdownOverlay ? (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/60 px-4 text-center">
              <p className="text-4xl font-semibold uppercase tracking-[0.15em] text-white">
                {formatCountdownLabel(countdownStep)}
              </p>
              <p className="mt-4 max-w-[14rem] text-xs leading-relaxed text-white/80">
                {PATIENT_POSITIONING_STEPS[0]}
              </p>
            </div>
          ) : null}

          {paused ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
              <p className="text-2xl font-semibold uppercase tracking-[0.2em] text-white">Paused</p>
            </div>
          ) : null}

          {cameraError ? (
            <p
              className="absolute bottom-3 left-3 right-3 z-30 text-center text-xs text-amber-200"
              role="alert"
            >
              {cameraError}
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            data-testid="mirror-exercise-exit"
            {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
            className={cn(mirrorControlButtonClass)}
            onClick={onExit}
          >
            Exit
          </Button>
        </div>
      </div>
    </MirrorPortraitCard>
  );
}
