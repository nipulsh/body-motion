import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, MicOff, Pause, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  COUNTDOWN_STEP_MS,
  createInitialSessionStats,
  finalizeSessionStats,
  formatCountdownLabel,
  getNextCountdownStep,
  isCameraPhase,
  isSetComplete,
  isTrackingPhase,
  leaveGetInPosition,
  nextExerciseIndex,
  shouldFinishExercise,
  shouldSpeakPositioning,
  type CountdownStep,
  type ExerciseSessionPhase,
} from '../../exercise/sessionState';
import {
  isPositiveFeedback,
  PATIENT_ERRORS,
  resolveLiveFeedback,
} from '../../exercise/patientFeedback';
import { CalibrationRecorder } from '../../exercise/calibration/calibrationRecorder';
import { PATIENT_POSITIONING_STEPS } from '../../exercise/calibration/cameraPositioning';
import { ExerciseDiagnosticOverlay } from '../../exercise/calibration/ExerciseDiagnosticOverlay';
import {
  isExerciseCalibrationAvailable,
  isExerciseDiagnosticEnabled,
} from '../../exercise/calibration/diagnosticMode';
import { normalizeExercise } from '../../exercise/normalizeExercise';
import { useExercise } from '../../hooks/useExercise';
import { useExerciseDemoVideo } from '../../hooks/useExerciseDemoVideo';
import { useExerciseVoiceCoaching } from '../../hooks/useExerciseVoiceCoaching';
import { RiggedModelViewer } from '../../bodyExplorer/RiggedModelViewer';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { ExerciseDemoVideo } from '../exercise/ExerciseDemoVideo';
import { FingertipTrailOverlay } from '../vision/FingertipTrailOverlay';
import { PoseWireframeOverlay } from '../vision/PoseWireframeOverlay';
import { useExerciseHandTrail } from '../../hooks/useExerciseHandTrail';
import { useWireframeHandTracking } from '../../hooks/useWireframeHandTracking';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { MirrorExerciseSessionView } from '../smartMirror/MirrorExerciseSessionView';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';

const TRANSITION_MS = 2800;

export function ExerciseScreen({ variant = 'clinical' }: { variant?: 'clinical' | 'mirror' }) {
  const isMirror = variant === 'mirror';
  const { state, dispatch } = useWorkflow();
  const exercises = state.exercises ?? [];
  const exerciseRaw = exercises[state.exerciseIndex] ?? null;
  const exercise = useMemo(
    () => (exerciseRaw ? normalizeExercise(exerciseRaw) : null),
    [exerciseRaw],
  );
  const nextExercise = exercises[state.exerciseIndex + 1] ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStageRef = useRef<HTMLDivElement>(null);
  const [videoFrameSize, setVideoFrameSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  const [phase, setPhase] = useState<ExerciseSessionPhase>('countdown');
  const [countdownStep, setCountdownStep] = useState<CountdownStep>('ready');
  const [currentSet, setCurrentSet] = useState(1);
  const [restSecondsRemaining, setRestSecondsRemaining] = useState(0);
  const [repCompletedFlash, setRepCompletedFlash] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [completedRepsThisSet, setCompletedRepsThisSet] = useState(0);
  const [transitionExerciseName, setTransitionExerciseName] = useState('');

  const sessionStatsRef = useRef(createInitialSessionStats());
  const lastRepCountRef = useRef(0);
  const previousPhaseRef = useRef<ExerciseSessionPhase>(phase);
  const restEndingSpokenRef = useRef(false);
  const positioningSpokenRef = useRef(false);
  const calibrationRecorderRef = useRef(new CalibrationRecorder());
  const [calibrationRecording, setCalibrationRecording] = useState(false);
  const diagnosticEnabled = isExerciseDiagnosticEnabled();
  const calibrationAvailable = isExerciseCalibrationAvailable();

  const cameraEnabled = isCameraPhase(phase) && Boolean(exercise);
  useWireframeHandTracking(videoRef, cameraEnabled);
  const trackingEnabled = isTrackingPhase(phase, paused) && Boolean(exercise);
  const isHandTrace = exercise?.modality === 'hand_trace';
  const handTrailEnabled = cameraEnabled && isHandTrace;
  const fingerTrail = useExerciseHandTrail(videoRef, cameraStageRef, handTrailEnabled);

  const {
    speakCountdown,
    speakRestStarted,
    speakRestEnding,
    speakExerciseTransition,
    speakRepPhase,
    speakPositioning,
    resetPhaseTracking,
    cancel: cancelVoice,
  } = useExerciseVoiceCoaching(voiceEnabled);

  const {
    demoVideoUrl,
    loadState: demoVideoLoadState,
    errorMessage: demoVideoError,
    retry: retryDemoVideo,
  } = useExerciseDemoVideo(exercise);

  const { pose, repResult, diagnostics, error, restartSet } = useExercise({
    videoRef,
    cameraEnabled,
    trackingEnabled,
    exercise,
  });

  useEffect(() => {
    return () => {
      cancelVoice();
    };
  }, [cancelVoice]);

  useEffect(() => {
    if (!cameraEnabled) {
      setVideoFrameSize(null);
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    const syncFrameSize = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoFrameSize({ width: video.videoWidth, height: video.videoHeight });
      }
    };

    syncFrameSize();
    video.addEventListener('loadedmetadata', syncFrameSize);
    video.addEventListener('resize', syncFrameSize);
    return () => {
      video.removeEventListener('loadedmetadata', syncFrameSize);
      video.removeEventListener('resize', syncFrameSize);
    };
  }, [cameraEnabled]);

  const [calibrationSampleCount, setCalibrationSampleCount] = useState(0);

  useEffect(() => {
    if (!calibrationRecording || !diagnostics) return;
    calibrationRecorderRef.current.record(diagnostics, performance.now());
    setCalibrationSampleCount(calibrationRecorderRef.current.count);
  }, [calibrationRecording, diagnostics]);

  useEffect(() => {
    return () => {
      calibrationRecorderRef.current.clear();
    };
  }, []);

  useEffect(() => {
    sessionStatsRef.current = createInitialSessionStats();
    dispatch({ type: 'CLEAR_EXERCISE_SESSION_STATS' });
  }, [dispatch]);

  const downloadCalibration = () => {
    const exerciseId = exercise?.id ?? 'exercise';
    calibrationRecorderRef.current.download(`${exerciseId}-calibration.jsonl`);
  };

  useEffect(() => {
    if (phase !== 'countdown') return;
    speakCountdown(countdownStep);
    const timer = window.setTimeout(() => {
      const next =
        countdownStep === 'ready'
          ? leaveGetInPosition(countdownStep)
          : getNextCountdownStep(countdownStep);
      if (next) {
        setCountdownStep(next);
        return;
      }
      resetPhaseTracking();
      setPhase('active');
    }, COUNTDOWN_STEP_MS[countdownStep]);
    return () => window.clearTimeout(timer);
  }, [countdownStep, phase, resetPhaseTracking, speakCountdown]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previous !== 'active' && phase === 'active') {
      restartSet();
      lastRepCountRef.current = 0;
      setCompletedRepsThisSet(0);
    }
  }, [phase, restartSet]);

  useEffect(() => {
    if (phase !== 'active' || !repResult) return;
    if (repResult.phase === 'REP_COMPLETED') {
      setRepCompletedFlash(true);
      const timer = window.setTimeout(() => setRepCompletedFlash(false), 700);
      return () => window.clearTimeout(timer);
    }
  }, [phase, repResult]);

  useEffect(() => {
    if (phase !== 'active' || paused || !repResult) return;
    speakRepPhase(repResult.phase, repResult.repCount);
  }, [paused, phase, repResult, speakRepPhase]);

  useEffect(() => {
    if (phase !== 'active' || paused || !repResult) return;
    if (repResult.repCount > lastRepCountRef.current) {
      sessionStatsRef.current.totalReps += repResult.repCount - lastRepCountRef.current;
      lastRepCountRef.current = repResult.repCount;
    }
    setCompletedRepsThisSet(repResult.repCount);
  }, [paused, phase, repResult]);

  useEffect(() => {
    if (phase !== 'active' || paused || !repResult || !exercise) return;
    if (!isSetComplete(repResult.repCount, exercise)) return;

    sessionStatsRef.current.setsCompleted += 1;

    if (shouldFinishExercise(currentSet, exercise)) {
      sessionStatsRef.current.exercisesCompleted += 1;
      setTransitionExerciseName(exercise.name);
      speakExerciseTransition(exercise.name);
      setPhase('exercise_transition');
      return;
    }

    speakRestStarted(exercise.restSeconds);
    setPhase('rest');
    setRestSecondsRemaining(exercise.restSeconds);
    restEndingSpokenRef.current = false;
  }, [currentSet, exercise, paused, phase, repResult, speakExerciseTransition, speakRestStarted]);

  useEffect(() => {
    if (phase !== 'rest' || restSecondsRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setRestSecondsRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, restSecondsRemaining]);

  useEffect(() => {
    if (phase !== 'rest' || restSecondsRemaining !== 3 || restEndingSpokenRef.current) return;
    restEndingSpokenRef.current = true;
    speakRestEnding();
  }, [phase, restSecondsRemaining, speakRestEnding]);

  useEffect(() => {
    if (phase !== 'rest' || restSecondsRemaining > 0 || !exercise) return;
    lastRepCountRef.current = 0;
    setCompletedRepsThisSet(0);
    restartSet();
    setCurrentSet((value) => value + 1);
    setCountdownStep('ready');
    setPhase('countdown');
  }, [exercise, phase, restSecondsRemaining, restartSet]);

  useEffect(() => {
    if (phase !== 'exercise_transition') return;
    const timer = window.setTimeout(() => {
      const nextIndex = nextExerciseIndex(state.exerciseIndex, exercises.length);
      if (nextIndex === null) {
        dispatch({
          type: 'SET_EXERCISE_SESSION_STATS',
          stats: finalizeSessionStats(sessionStatsRef.current),
        });
        dispatch({ type: 'SET_STAGE', stage: isMirror ? 'mirror_home' : 'exercise_complete' });
        return;
      }
      dispatch({ type: 'SET_EXERCISE_INDEX', index: nextIndex });
    }, TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [dispatch, exercises.length, isMirror, phase, state.exerciseIndex]);

  useEffect(() => {
    setCurrentSet(1);
    setPaused(false);
    setCountdownStep('ready');
    setPhase('countdown');
    setRestSecondsRemaining(0);
    setRepCompletedFlash(false);
    setCompletedRepsThisSet(0);
    lastRepCountRef.current = 0;
    restEndingSpokenRef.current = false;
    resetPhaseTracking();
  }, [state.exerciseIndex, resetPhaseTracking]);

  const displayFeedback = resolveLiveFeedback(
    pose,
    trackingEnabled ? repResult : null,
    phase === 'countdown' ? 'GET READY' : 'GET READY',
  );

  useEffect(() => {
    if (!shouldSpeakPositioning(phase, countdownStep)) {
      positioningSpokenRef.current = false;
      return;
    }
    if (positioningSpokenRef.current) return;
    if (displayFeedback.includes('POSITION') || displayFeedback.includes('FULL BODY')) {
      positioningSpokenRef.current = true;
      speakPositioning(displayFeedback);
    }
  }, [countdownStep, displayFeedback, phase, speakPositioning]);

  const repCount = repResult?.repCount ?? 0;
  const targetReps = exercise?.recommendedReps ?? 0;
  const positive = isPositiveFeedback(displayFeedback, repResult);

  const handleExit = () => {
    cancelVoice();
    dispatch({ type: 'SET_STAGE', stage: isMirror ? 'mirror_home' : state.exerciseReturnStage });
  };

  if (!exercise) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-2xl text-muted-foreground">No exercise selected.</p>
      </div>
    );
  }

  const devControls = calibrationAvailable ? (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        type="button"
        variant={calibrationRecording ? 'destructive' : 'outline'}
        className="min-h-10"
        onClick={() => setCalibrationRecording((value) => !value)}
      >
        {calibrationRecording ? 'Stop recording' : 'Record calibration'}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-10"
        disabled={calibrationSampleCount === 0}
        onClick={downloadCalibration}
      >
        Download JSONL ({calibrationSampleCount})
      </Button>
    </div>
  ) : null;

  const controls = (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          variant="secondary"
          className="min-h-14 min-w-32 text-lg"
          onClick={() => setPaused((value) => !value)}
          disabled={phase !== 'active'}
        >
          {paused ? <Play className="mr-2 size-5" /> : <Pause className="mr-2 size-5" />}
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-14 min-w-32 text-lg"
          onClick={() => setVoiceEnabled((value) => !value)}
        >
          {voiceEnabled ? <Mic className="mr-2 size-5" /> : <MicOff className="mr-2 size-5" />}
          {voiceEnabled ? 'Voice On' : 'Voice Off'}
        </Button>
        <Button type="button" variant="outline" className="min-h-14 min-w-32 text-lg" onClick={handleExit}>
          <X className="mr-2 size-5" />
          Exit
        </Button>
      </div>
      {devControls}
    </div>
  );

  if (phase === 'exercise_transition') {
    if (isMirror) {
      return (
        <MirrorPortraitCard testId="mirror-exercise-transition-card">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm font-medium text-white">Exercise complete</p>
            <p className="text-xl font-semibold text-white">{transitionExerciseName}</p>
            {nextExercise ? (
              <p className="text-sm text-neutral-300">Next: {nextExercise.name}</p>
            ) : null}
          </div>
        </MirrorPortraitCard>
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-center">
        <p className="text-xl uppercase tracking-[0.35em] text-primary">Exercise complete</p>
        <h1 className="mt-6 text-5xl font-semibold lg:text-6xl">{transitionExerciseName}</h1>
        {nextExercise ? (
          <div className="mt-10 space-y-3">
            <p className="text-lg uppercase tracking-[0.25em] text-muted-foreground">Next</p>
            <p className="text-4xl font-medium">{nextExercise.name}</p>
          </div>
        ) : null}
        <p className="mt-10 text-2xl text-muted-foreground">Get ready…</p>
        <div className="mt-12">{controls}</div>
      </div>
    );
  }

  if (phase === 'rest') {
    if (isMirror) {
      return (
        <MirrorPortraitCard testId="mirror-exercise-rest-card">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm font-medium text-white">Rest</p>
            <p className="text-5xl font-semibold tabular-nums text-white">{restSecondsRemaining}</p>
            <p className="text-sm text-neutral-300">{exercise.name}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={handleExit}>
              Exit
            </Button>
          </div>
        </MirrorPortraitCard>
      );
    }
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center p-8 text-center">
        <p className="text-xl uppercase tracking-[0.35em] text-emerald-300">Set complete</p>
        <h1 className="mt-4 text-5xl font-semibold">Great work!</h1>
        <p className="mt-8 text-lg uppercase tracking-[0.25em] text-muted-foreground">Next set in</p>
        <p className="mt-4 text-8xl font-semibold tabular-nums">{restSecondsRemaining}</p>
        <div className="mt-10 space-y-2 text-2xl text-muted-foreground">
          <p>{exercise.name}</p>
          <p>
            Set {currentSet} / {exercise.sets}
          </p>
          <p>Completed reps: {completedRepsThisSet}</p>
        </div>
        <Progress
          className="mt-10 w-full max-w-xl"
          value={((exercise.restSeconds - restSecondsRemaining) / Math.max(exercise.restSeconds, 1)) * 100}
        />
        <div className="mt-12">{controls}</div>
      </div>
    );
  }

  const showCountdownOverlay = phase === 'countdown';
  const cameraError =
    error ?? (!error && phase === 'active' && !pose && cameraEnabled ? PATIENT_ERRORS.pose : null);

  if (isMirror) {
    return (
      <MirrorExerciseSessionView
        exercise={exercise}
        videoRef={videoRef}
        cameraStageRef={cameraStageRef}
        pose={pose}
        videoFrameSize={videoFrameSize}
        fingerTrail={fingerTrail}
        isHandTrace={isHandTrace}
        repCount={repCount}
        targetReps={targetReps}
        countdownStep={countdownStep}
        paused={paused}
        showCountdownOverlay={showCountdownOverlay}
        demoVideoUrl={demoVideoUrl}
        demoVideoLoadState={demoVideoLoadState}
        demoVideoError={demoVideoError}
        onRetryDemoVideo={retryDemoVideo}
        cameraError={cameraError}
        onExit={handleExit}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col bg-background p-4 lg:p-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg uppercase tracking-[0.2em] text-muted-foreground">{exercise.name}</p>
          <p className="mt-1 text-base text-muted-foreground">
            Set {currentSet} / {exercise.sets} · Exercise {state.exerciseIndex + 1} / {exercises.length}
          </p>
        </div>
        {controls}
      </div>

      <div className="mb-6 text-center">
        <p className="text-sm uppercase tracking-[0.35em] text-muted-foreground">
          {isHandTrace ? 'Activity' : 'Reps'}
        </p>
        <div className="relative mt-2 inline-flex items-center justify-center gap-4">
          {!isHandTrace && repCompletedFlash ? (
            <span className="absolute -left-10 text-5xl text-emerald-400 lg:-left-14 lg:text-6xl">
              <Check aria-hidden />
            </span>
          ) : null}
          {isHandTrace ? (
            <p className="text-4xl font-semibold tracking-tight text-amber-200 lg:text-5xl">
              Finger tracing
            </p>
          ) : (
            <p
              className={cn(
                'text-7xl font-semibold tabular-nums tracking-tight lg:text-8xl',
                repCompletedFlash && 'text-emerald-400',
              )}
            >
              {repCount}
              <span className="text-muted-foreground"> / {targetReps}</span>
            </p>
          )}
        </div>
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)] lg:gap-6">
        <div
          ref={cameraStageRef}
          className="relative min-h-[360px] overflow-hidden rounded-3xl border-2 border-white/10 bg-black/50 lg:min-h-[520px]"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-preview mirror-video h-full w-full object-contain"
          />
          <PoseWireframeOverlay pose={pose} sourceFrame={videoFrameSize} mirrorX />
          {isHandTrace ? <FingertipTrailOverlay trail={fingerTrail} /> : null}
          {repCompletedFlash ? (
            <div className="pointer-events-none absolute inset-0 border-4 border-emerald-400/80 bg-transparent" />
          ) : null}
          {showCountdownOverlay ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 px-6 text-center backdrop-blur-[1px]">
              <p className="text-6xl font-semibold uppercase tracking-[0.2em] text-white lg:text-8xl">
                {formatCountdownLabel(countdownStep)}
              </p>
              <p className="mt-6 max-w-md text-lg text-white/80">{PATIENT_POSITIONING_STEPS[0]}</p>
            </div>
          ) : null}
          {diagnosticEnabled && diagnostics ? (
            <ExerciseDiagnosticOverlay diagnostics={diagnostics} />
          ) : null}
          {paused ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <p className="text-5xl font-semibold uppercase tracking-[0.25em] text-white">Paused</p>
            </div>
          ) : null}
        </div>

        {state.riggedGlbUrl ? (
          <div className="flex min-h-[360px] flex-col overflow-hidden rounded-3xl border-2 border-white/10 bg-black/50 lg:min-h-[520px]">
            <p className="px-4 py-3 text-center text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Your 3D model
            </p>
            <RiggedModelViewer
              glbUrl={state.riggedGlbUrl}
              className="rigged-canvas min-h-0 flex-1"
            />
          </div>
        ) : (
          <ExerciseDemoVideo
            exerciseName={exercise.name}
            videoUrl={demoVideoUrl ?? exercise.demoVideoUrl}
            description={exercise.description}
            generating={demoVideoLoadState === 'generating'}
            generateError={demoVideoError}
            onRetryGenerate={retryDemoVideo}
            className="min-h-[360px] lg:min-h-[520px]"
          />
        )}
      </div>

      <div className="mt-8 space-y-4 text-center">
        <p
          className={cn(
            'text-4xl font-semibold uppercase tracking-wide lg:text-5xl',
            positive ? 'text-emerald-300' : 'text-amber-200',
          )}
        >
          {displayFeedback}
        </p>
        <p className="text-xl text-muted-foreground">{exercise.instructions[0]}</p>
        {error ? (
          <p className="text-xl text-amber-200">{error}</p>
        ) : null}
        {!error && phase === 'active' && !pose && cameraEnabled ? (
          <p className="text-xl text-amber-200">{PATIENT_ERRORS.pose}</p>
        ) : null}
      </div>
    </div>
  );
}
