import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getDesktopBridge } from '../../desktop/desktopApi';
import type { Exercise } from '@vision';
import { useSmartMirrorChannel, type MirrorFrameSink } from '../../hooks/useSmartMirrorChannel';
import { useSmartMirrorExercise } from '../../hooks/useSmartMirrorExercise';
import { useSmartMirrorPose } from '../../hooks/useSmartMirrorPose';
import { ExerciseDemoVideo } from '../exercise/ExerciseDemoVideo';
import {
  PoseWireframeOverlay,
  type PoseWireframeOverlayHandle,
} from '../vision/PoseWireframeOverlay';
import { formatMirrorRepCount } from './smartMirrorExercise';

export interface SmartMirrorScreenProps {
  /** When set, display this session exercise instead of the live VisionManager exercise. */
  exercise?: Exercise | null;
  repCount?: number | null;
  targetReps?: number | null;
  /** The external TV window. It receives pose data and does not start a camera. */
  remote?: boolean;
}

const screenStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  padding: 0,
  border: 'none',
  overflow: 'hidden',
  backgroundColor: '#000000',
  color: '#ffffff',
};

const wireframeStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 0,
  pointerEvents: 'none',
  backgroundColor: 'transparent',
};

const exerciseStyle: CSSProperties = {
  position: 'absolute',
  top: '2%',
  right: '2%',
  width: '33%',
  zIndex: 10,
  pointerEvents: 'none',
};

function useMirrorStroke() {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1080 : window.innerWidth,
  );

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const lineWidth = Math.max(6, Math.round(viewportWidth * 0.012));
  return {
    lineWidth,
    jointRadius: Math.max(5, Math.round(lineWidth * 0.55)),
  };
}

export function SmartMirrorScreen(props: SmartMirrorScreenProps) {
  if (props.remote) return <RemoteSmartMirrorScreen />;
  return <LocalSmartMirrorScreen {...props} />;
}

function LocalSmartMirrorScreen({
  exercise: exerciseProp,
  repCount: repCountProp,
  targetReps: targetRepsProp,
}: SmartMirrorScreenProps) {
  const frameSink = useRef<MirrorFrameSink['current']>(() => {});
  const liveExercise = useSmartMirrorExercise();
  const { error } = useSmartMirrorPose((pose, frame) => {
    frameSink.current(pose, frame);
  });
  const controlled = exerciseProp !== undefined;
  const exercise = controlled ? exerciseProp : liveExercise.exercise;
  const repCount = controlled ? (repCountProp ?? (exercise ? 0 : null)) : liveExercise.repCount;
  const targetReps = controlled
    ? (targetRepsProp ?? exercise?.recommendedReps ?? null)
    : liveExercise.targetReps;

  return (
    <SmartMirrorView
      exerciseName={exercise?.name ?? null}
      demoVideoUrl={exercise?.demoVideoUrl ?? null}
      repCount={repCount}
      targetReps={targetReps}
      error={error}
      frameSink={frameSink}
    />
  );
}

function RemoteSmartMirrorScreen() {
  const frameSink = useRef<MirrorFrameSink['current']>(() => {});
  const remote = useSmartMirrorChannel(frameSink);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      void getDesktopBridge()?.closeWindow();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <SmartMirrorView
      exerciseName={remote.exercise?.name ?? null}
      demoVideoUrl={remote.exercise?.demoVideoUrl ?? null}
      repCount={remote.exercise?.repCount ?? null}
      targetReps={remote.exercise?.targetReps ?? null}
      error={remote.error}
      frameSink={frameSink}
    />
  );
}

function SmartMirrorView({
  exerciseName,
  demoVideoUrl,
  repCount,
  targetReps,
  error,
  frameSink,
}: {
  exerciseName: string | null;
  demoVideoUrl: string | null;
  repCount: number | null;
  targetReps: number | null;
  error: string | null;
  frameSink: MirrorFrameSink;
}) {
  const stroke = useMirrorStroke();
  const wireframeRef = useRef<PoseWireframeOverlayHandle>(null);
  const showSession = exerciseName != null && repCount != null && targetReps != null;

  useEffect(() => {
    frameSink.current = (pose, frame, hands) => {
      wireframeRef.current?.draw(pose, frame, hands);
    };
    return () => {
      frameSink.current = () => {};
    };
  }, [frameSink]);

  return (
    <section
      className="smart-mirror-screen"
      style={screenStyle}
      aria-label="Smart mirror"
      data-testid="smart-mirror-screen"
    >
      <div
        className="smart-mirror-wireframe"
        style={wireframeStyle}
        data-testid="smart-mirror-wireframe"
        aria-hidden
      >
        <PoseWireframeOverlay
          ref={wireframeRef}
          lineWidth={stroke.lineWidth}
          jointRadius={stroke.jointRadius}
          mirrorX
        />
      </div>

      <div
        className="smart-mirror-exercise"
        style={exerciseStyle}
        data-testid="smart-mirror-exercise"
      >
        {showSession ? (
          <>
            <div className="smart-mirror-demo-slot">
              <ExerciseDemoVideo
                exerciseName={exerciseName}
                videoUrl={demoVideoUrl}
                className="smart-mirror-demo-media min-h-0 max-h-[22vh] w-full border-0 bg-transparent p-0"
              />
            </div>
            <h1 className="smart-mirror-exercise-name">{exerciseName}</h1>
            <p
              className="smart-mirror-rep-count"
              aria-label={`Reps ${repCount} of ${targetReps}`}
            >
              {formatMirrorRepCount(repCount, targetReps)}
            </p>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="smart-mirror-status" role="alert" data-testid="smart-mirror-status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
