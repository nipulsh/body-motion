import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, MicOff, Pause, Play, X } from 'lucide-react';
import { formRanges, formScoresReps, type RangeModel, type RangeRep } from '@vision';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
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
  derivePositioningFeedback,
  isPositiveFeedback,
  PATIENT_ERRORS,
  resolveLiveFeedback,
} from '../../exercise/patientFeedback';
import {
  needsViewChoice,
  rangeRepFeedback,
  rangeRepVoice,
  requiredViewFor,
  setViewDescription,
  viewPrompt,
  viewPromptShort,
  type CompletedRangeSet,
  type ViewChoice,
} from '../../exercise/rangeModelSession';
import { CalibrationRecorder } from '../../exercise/calibration/calibrationRecorder';
import { PATIENT_POSITIONING_STEPS } from '../../exercise/calibration/cameraPositioning';
import { ExerciseDiagnosticOverlay } from '../../exercise/calibration/ExerciseDiagnosticOverlay';
import {
  isExerciseCalibrationAvailable,
  isExerciseDiagnosticEnabled,
} from '../../exercise/calibration/diagnosticMode';
import { activeFormFault, formFaultCorrection } from '../../exercise/exerciseVoiceCoaching';
import { normalizeExercise } from '../../exercise/normalizeExercise';
import { useExercise } from '../../hooks/useExercise';
import { useExerciseDemoVideo } from '../../hooks/useExerciseDemoVideo';
import { useExerciseVoiceCoaching } from '../../hooks/useExerciseVoiceCoaching';
import { RiggedModelViewer } from '../../bodyExplorer/RiggedModelViewer';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { ExerciseDemoVideo } from '../exercise/ExerciseDemoVideo';
import { RangeModelPicker } from '../exercise/RangeModelPicker';
import { RangeSetSummary } from '../exercise/RangeSetSummary';
import { PoseWireframeOverlay } from '../vision/PoseWireframeOverlay';
import { useWireframeHandTracking } from '../../hooks/useWireframeHandTracking';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { mirrorGestureButtonClass } from '../smartMirror/mirrorGestureButton';
import { MirrorExerciseSessionView } from '../smartMirror/MirrorExerciseSessionView';
import { useOptionalMirrorHandNav } from '../smartMirror/MirrorHandNavContext';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneFillClass } from '../smartMirror/mirrorTopZone';

const TRANSITION_MS = 2800;
/** The last set's summary stays up longer, so it can be read. */
const TRANSITION_WITH_SUMMARY_MS = 8000;
/** Squat and lunge models: the patient must face the set's way this long before the countdown goes on. */
const VIEW_SETTLE_MS = 800;
/** How often the turn-to-the-camera prompt is repeated while the patient faces the wrong way. */
const VIEW_PROMPT_REPEAT_MS = 6000;

/** The exercise kind a front or side choice was made for. */
function choiceKind(choice: ViewChoice): RangeModel['kind'] {
  return choice.view === 'front' ? choice.kind : choice.model.kind;
}

export function ExerciseScreen({ variant = 'clinical' }: { variant?: 'clinical' | 'mirror' }) {
  const isMirror = variant === 'mirror';
  const { state, dispatch } = useWorkflow();
  // Mirror sessions go back where they started (home, or a results page's suggested exercises).
  const mirrorExitStage =
    state.exerciseReturnStage === 'mirror_results' || state.exerciseReturnStage === 'mirror_demo_results'
      ? state.exerciseReturnStage
      : 'mirror_home';
  const exercises = state.exercises ?? [];
  const exerciseRaw = exercises[state.exerciseIndex] ?? null;
  const baseExercise = useMemo(
    () => (exerciseRaw ? normalizeExercise(exerciseRaw) : null),
    [exerciseRaw],
  );
  // Squats and lunges first ask front or side: front is the standard check, side judges a picked model.
  const modelNeeded = needsViewChoice(baseExercise);
  const [pickedChoice, setPickedChoice] = useState<ViewChoice | null>(null);
  const viewChoice =
    modelNeeded && pickedChoice && choiceKind(pickedChoice) === baseExercise?.formCheck ? pickedChoice : null;
  const rangeModel = viewChoice?.view === 'side' ? viewChoice.model : null;
  const exercise = useMemo(
    () => (baseExercise && rangeModel ? { ...baseExercise, rangeModel: rangeModel.id } : baseExercise),
    [baseExercise, rangeModel],
  );
  const nextExercise = exercises[state.exerciseIndex + 1] ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStageRef = useRef<HTMLDivElement>(null);
  const [videoFrameSize, setVideoFrameSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  const [phase, setPhase] = useState<ExerciseSessionPhase>(() => (modelNeeded ? 'choose_model' : 'countdown'));
  const [countdownStep, setCountdownStep] = useState<CountdownStep>('ready');
  const [currentSet, setCurrentSet] = useState(1);
  const [restSecondsRemaining, setRestSecondsRemaining] = useState(0);
  const [repCompletedFlash, setRepCompletedFlash] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [completedRepsThisSet, setCompletedRepsThisSet] = useState(0);
  const [transitionExerciseName, setTransitionExerciseName] = useState('');
  /** Squat or lunge model: the set just finished, for its summary on the rest and transition screens. */
  const [completedRangeSet, setCompletedRangeSet] = useState<CompletedRangeSet | null>(null);
  const [lastRangeRep, setLastRangeRep] = useState<RangeRep | null>(null);
  const handledRangeAttemptsRef = useRef(0);
  const [viewSettled, setViewSettled] = useState(false);
  const modelNeededRef = useRef(modelNeeded);
  modelNeededRef.current = modelNeeded;
  const modelSession = rangeModel !== null;
  const requiredView = requiredViewFor(rangeModel);

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
  // Mirror navigation reads this tracker's hands only while it runs; otherwise it uses its own camera.
  const setExerciseHandTrackingActive = useOptionalMirrorHandNav()?.setExerciseHandTrackingActive;
  useEffect(() => {
    if (!setExerciseHandTrackingActive) return;
    setExerciseHandTrackingActive(cameraEnabled);
    return () => setExerciseHandTrackingActive(false);
  }, [cameraEnabled, setExerciseHandTrackingActive]);
  const trackingEnabled = isTrackingPhase(phase, paused) && Boolean(exercise);
  const isHandTrace = exercise?.modality === 'hand_trace';

  const {
    speakCountdown,
    speakRestStarted,
    speakRestEnding,
    speakExerciseTransition,
    speakRepPhase,
    speakFormFault,
    speakPositioning,
    speakRangeRep,
    speakViewPrompt,
    resetPhaseTracking,
    cancel: cancelVoice,
  } = useExerciseVoiceCoaching(voiceEnabled);

  const {
    demoVideoUrl,
    loadState: demoVideoLoadState,
    errorMessage: demoVideoError,
    retry: retryDemoVideo,
  } = useExerciseDemoVideo(baseExercise);

  const { pose, repResult, form, diagnostics, error, restartSet } = useExercise({
    videoRef,
    cameraEnabled,
    trackingEnabled,
    exercise,
    formView: requiredView,
  });
  const formFault = phase === 'active' && !paused ? activeFormFault(form) : null;
  const ranges = modelSession ? formRanges(form) : null;
  const seenView = ranges?.view ?? null;
  // Only a view actually seen the wrong way round asks the patient to turn; no pose is a positioning problem.
  const viewMismatch = requiredView !== null && seenView !== null && seenView !== requiredView;
  const holdForView = phase === 'countdown' && countdownStep === 'ready' && requiredView !== null && !viewSettled;
  const promptView =
    requiredView && (holdForView || (phase === 'active' && !paused && viewMismatch)) ? requiredView : null;

  useEffect(() => {
    if (!requiredView || seenView !== requiredView) {
      setViewSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setViewSettled(true), VIEW_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [requiredView, seenView]);

  useEffect(() => {
    if (!promptView) return;
    speakViewPrompt(viewPrompt(promptView));
    const timer = window.setInterval(() => speakViewPrompt(viewPrompt(promptView)), VIEW_PROMPT_REPEAT_MS);
    return () => window.clearInterval(timer);
  }, [promptView, speakViewPrompt]);

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
    // Squat and lunge models: "ready" waits until the patient faces the way this set needs.
    if (holdForView) return;
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
  }, [countdownStep, holdForView, phase, resetPhaseTracking, speakCountdown]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previous !== 'active' && phase === 'active') {
      restartSet();
      lastRepCountRef.current = 0;
      handledRangeAttemptsRef.current = 0;
      setLastRangeRep(null);
      setCompletedRepsThisSet(0);
    }
  }, [phase, restartSet]);

  useEffect(() => {
    if (phase !== 'active' || !repResult || modelSession) return;
    if (repResult.phase === 'REP_COMPLETED') {
      setRepCompletedFlash(true);
      const timer = window.setTimeout(() => setRepCompletedFlash(false), 700);
      return () => window.clearTimeout(timer);
    }
  }, [modelSession, phase, repResult]);

  // Squat and lunge models: each judged rep is counted (correct, borderline) or corrected (incorrect).
  useEffect(() => {
    if (!rangeModel || phase !== 'active' || !ranges) return;
    const attempts = ranges.reps.length;
    if (attempts < handledRangeAttemptsRef.current) handledRangeAttemptsRef.current = 0;
    if (attempts === handledRangeAttemptsRef.current) return;
    const fresh = ranges.reps.slice(handledRangeAttemptsRef.current);
    handledRangeAttemptsRef.current = attempts;
    const rep = fresh[fresh.length - 1]!;
    setLastRangeRep(rep);
    if (!paused) speakRangeRep(rangeRepVoice(rep, ranges.summary.counted, rangeModel), rep.attempt);
    if (fresh.some((judged) => judged.counted)) setRepCompletedFlash(true);
  }, [paused, phase, rangeModel, ranges, speakRangeRep]);

  useEffect(() => {
    if (!modelSession || !repCompletedFlash) return;
    const timer = window.setTimeout(() => setRepCompletedFlash(false), 700);
    return () => window.clearTimeout(timer);
  }, [modelSession, repCompletedFlash]);

  useEffect(() => {
    speakFormFault(formFault);
  }, [formFault, form, speakFormFault]);

  useEffect(() => {
    // A model speaks its own rep outcomes; the joint-angle rep counter's cues would contradict them.
    if (phase !== 'active' || paused || !repResult || modelSession) return;
    // A held form correction speaks instead of the generic phase cue; rep counts still speak.
    const silent = Boolean(formFault) && repResult.phase !== 'REP_COMPLETED';
    speakRepPhase(repResult.phase, repResult.repCount, silent);
  }, [formFault, modelSession, paused, phase, repResult, speakRepPhase]);

  // With a model only counted reps (correct or borderline) count toward the set.
  const sessionRepCount = modelSession ? ranges?.summary.counted : repResult?.repCount;

  useEffect(() => {
    if (phase !== 'active' || paused || sessionRepCount === undefined) return;
    if (sessionRepCount > lastRepCountRef.current) {
      sessionStatsRef.current.totalReps += sessionRepCount - lastRepCountRef.current;
      lastRepCountRef.current = sessionRepCount;
    }
    setCompletedRepsThisSet(sessionRepCount);
  }, [paused, phase, sessionRepCount]);

  useEffect(() => {
    if (phase !== 'active' || paused || sessionRepCount === undefined || !exercise) return;
    if (!isSetComplete(sessionRepCount, exercise)) return;

    sessionStatsRef.current.setsCompleted += 1;
    if (rangeModel && ranges && requiredView) {
      setCompletedRangeSet({ setNumber: currentSet, view: requiredView, model: rangeModel, summary: ranges.summary });
    }

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
  }, [
    currentSet,
    exercise,
    paused,
    phase,
    rangeModel,
    ranges,
    requiredView,
    sessionRepCount,
    speakExerciseTransition,
    speakRestStarted,
  ]);

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
        dispatch({ type: 'SET_STAGE', stage: isMirror ? mirrorExitStage : 'exercise_complete' });
        return;
      }
      dispatch({ type: 'SET_EXERCISE_INDEX', index: nextIndex });
    }, completedRangeSet ? TRANSITION_WITH_SUMMARY_MS : TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [completedRangeSet, dispatch, exercises.length, isMirror, mirrorExitStage, phase, state.exerciseIndex]);

  useEffect(() => {
    setCurrentSet(1);
    setPaused(false);
    setCountdownStep('ready');
    setPickedChoice(null);
    setCompletedRangeSet(null);
    setLastRangeRep(null);
    handledRangeAttemptsRef.current = 0;
    setPhase(modelNeededRef.current ? 'choose_model' : 'countdown');
    setRestSecondsRemaining(0);
    setRepCompletedFlash(false);
    setCompletedRepsThisSet(0);
    lastRepCountRef.current = 0;
    restEndingSpokenRef.current = false;
    resetPhaseTracking();
  }, [state.exerciseIndex, resetPhaseTracking]);

  // The exercise list can arrive after the screen mounts: a squat or lunge still starts at the picker.
  useEffect(() => {
    if (modelNeeded && !viewChoice && phase === 'countdown') setPhase('choose_model');
  }, [modelNeeded, phase, viewChoice]);

  const liveFeedback = resolveLiveFeedback(
    pose,
    trackingEnabled ? repResult : null,
    phase === 'countdown' ? 'GET READY' : 'GET READY',
  );
  const faultCorrection = formFault ? formFaultCorrection(formFault).toUpperCase() : null;
  const rangeFeedback = lastRangeRep && rangeModel ? rangeRepFeedback(lastRangeRep, rangeModel) : null;
  // Facing the wrong way blocks every rep of the set, so it is said first.
  const formCorrection = promptView ? viewPromptShort(promptView) : faultCorrection;
  const modelFeedback = rangeModel
    ? (formCorrection ??
      derivePositioningFeedback(pose, trackingEnabled ? repResult : null) ??
      (phase === 'active' ? (rangeFeedback?.text ?? 'START WHEN READY') : 'GET READY'))
    : null;
  const displayFeedback = modelFeedback ?? formCorrection ?? liveFeedback;

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

  const repCount = (modelSession ? ranges?.summary.counted : repResult?.repCount) ?? 0;
  const targetReps = exercise?.recommendedReps ?? 0;
  const positive = modelSession
    ? !formCorrection && displayFeedback === rangeFeedback?.text && rangeFeedback.tone !== 'incorrect'
    : !formCorrection && isPositiveFeedback(displayFeedback, repResult);
  const countdownPrompt = holdForView && requiredView ? viewPrompt(requiredView) : null;
  const rangeQuality = modelSession && ranges ? ranges.summary : null;

  const handleExit = () => {
    cancelVoice();
    dispatch({ type: 'SET_STAGE', stage: isMirror ? mirrorExitStage : state.exerciseReturnStage });
  };

  if (!exercise) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-2xl text-muted-foreground">No exercise selected.</p>
      </div>
    );
  }

  if (phase === 'choose_model') {
    return (
      <RangeModelPicker
        exercise={exercise}
        variant={isMirror ? 'mirror' : 'clinical'}
        onExit={handleExit}
        onPickFront={() => {
          setPickedChoice({ view: 'front', kind: exercise.formCheck === 'lunge' ? 'lunge' : 'squat' });
          setCountdownStep('ready');
          setPhase('countdown');
        }}
        onPick={(model) => {
          setPickedChoice({ view: 'side', model });
          setCountdownStep('ready');
          setPhase('countdown');
        }}
      />
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
        {isMirror ? (
          <>
            <Button
              type="button"
              variant="outline"
              className={cn(mirrorGestureButtonClass)}
              onClick={() => setPaused((value) => !value)}
              disabled={phase !== 'active'}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(mirrorGestureButtonClass)}
              onClick={() => setVoiceEnabled((value) => !value)}
            >
              {voiceEnabled ? 'Voice on' : 'Voice off'}
            </Button>
            <Button type="button" variant="outline" className={cn(mirrorGestureButtonClass)} onClick={handleExit}>
              Exit
            </Button>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
      {devControls}
    </div>
  );

  if (phase === 'exercise_transition') {
    if (isMirror) {
      return (
        <MirrorPortraitCard testId="mirror-exercise-transition-card">
          <div className={cn('flex flex-col items-center justify-center-safe gap-4 p-8 text-center', mirrorTopZoneFillClass)}>
            <p className="text-sm font-medium text-white">Exercise complete</p>
            <p className="text-xl font-semibold text-white">{transitionExerciseName}</p>
            {completedRangeSet ? <RangeSetSummary set={completedRangeSet} variant="mirror" /> : null}
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
        {completedRangeSet ? <RangeSetSummary set={completedRangeSet} variant="clinical" className="mt-8" /> : null}
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
          <div className={cn('flex flex-col items-center justify-center-safe gap-4 p-8 text-center', mirrorTopZoneFillClass)}>
            <p className="text-sm font-medium text-white">Rest</p>
            <p className="text-5xl font-semibold tabular-nums text-white">{restSecondsRemaining}</p>
            <p className="text-sm text-neutral-300">{exercise.name}</p>
            {completedRangeSet ? <RangeSetSummary set={completedRangeSet} variant="mirror" /> : null}
            <Button
              type="button"
              variant="outline"
              {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
              className={cn(mirrorGestureButtonClass, 'mt-4')}
              onClick={handleExit}
            >
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
        {completedRangeSet ? <RangeSetSummary set={completedRangeSet} variant="clinical" className="mt-8" /> : null}
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
        form={form}
        formCorrection={formCorrection}
        videoFrameSize={videoFrameSize}
        isHandTrace={isHandTrace}
        repCount={repCount}
        targetReps={targetReps}
        countdownStep={countdownStep}
        countdownPrompt={countdownPrompt}
        rangeQuality={rangeQuality}
        rangeStatus={
          rangeFeedback && !formCorrection && phase === 'active'
            ? { text: rangeFeedback.text, tone: rangeFeedback.tone }
            : null
        }
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
        {rangeQuality ? (
          <div className="mt-3 flex justify-center gap-3 text-lg font-semibold">
            <span className="rounded-lg bg-emerald-500/90 px-3 py-1 text-white">Correct: {rangeQuality.correct}</span>
            <span className="rounded-lg bg-amber-500/90 px-3 py-1 text-white">Borderline: {rangeQuality.borderline}</span>
            <span className="rounded-lg bg-red-500/90 px-3 py-1 text-white">Incorrect: {rangeQuality.incorrect}</span>
          </div>
        ) : form && formScoresReps(form) ? (
          <div className="mt-3 flex justify-center gap-3 text-lg font-semibold">
            <span className="rounded-lg bg-emerald-500/90 px-3 py-1 text-white">Correct: {form.correctReps}</span>
            <span className="rounded-lg bg-red-500/90 px-3 py-1 text-white">Incorrect: {form.incorrectReps}</span>
          </div>
        ) : null}
        {rangeModel && requiredView ? (
          <p className="mt-2 text-base text-muted-foreground">
            {rangeModel.label} · {setViewDescription(rangeModel, requiredView)}
          </p>
        ) : null}
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
          <PoseWireframeOverlay pose={pose} sourceFrame={videoFrameSize} mirrorX form={form} />
          {repCompletedFlash ? (
            <div className="pointer-events-none absolute inset-0 border-4 border-emerald-400/80 bg-transparent" />
          ) : null}
          {showCountdownOverlay ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 px-6 text-center backdrop-blur-[1px]">
              <p className="text-6xl font-semibold uppercase tracking-[0.2em] text-white lg:text-8xl">
                {countdownPrompt ? 'TURN' : formatCountdownLabel(countdownStep)}
              </p>
              <p className="mt-6 max-w-md text-lg text-white/80">{countdownPrompt ?? PATIENT_POSITIONING_STEPS[0]}</p>
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
