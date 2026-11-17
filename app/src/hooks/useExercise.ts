import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  getVisionManager,
  userMessageForVisionError,
  VisionError,
  type Exercise,
  type ExerciseFrameDiagnostics,
  type ExerciseFramePayload,
  type PoseResult,
  type RepDetectionResult,
  type ExerciseFormResult,
  type RangeView,
} from '@vision';
import { installNeutralSpineSessionStore } from '../exercise/neutralSpineSession';
import { PATIENT_ERRORS } from '../exercise/patientFeedback';
import { useVision } from './useVision';

export interface UseExerciseOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraEnabled: boolean;
  trackingEnabled: boolean;
  exercise: Exercise | null;
  /** Squat and lunge models: the view this set is judged in. */
  formView?: RangeView | null;
  onFrame?: (payload: ExerciseFramePayload) => void;
}

export interface UseExerciseResult {
  pose: PoseResult | null;
  repResult: RepDetectionResult | null;
  /** Form analysis (squat, lunge) for exercises with `formCheck`; null otherwise. */
  form: ExerciseFormResult | null;
  diagnostics: ExerciseFrameDiagnostics | null;
  cameraReady: boolean;
  poseReady: boolean;
  error: string | null;
  restartSet: () => void;
}

function toPatientCameraError(err: unknown): string {
  if (err instanceof VisionError) {
    return userMessageForVisionError(err.code);
  }
  return PATIENT_ERRORS.camera;
}

export function useExercise({
  videoRef,
  cameraEnabled,
  trackingEnabled,
  exercise,
  formView = null,
  onFrame,
}: UseExerciseOptions): UseExerciseResult {
  const manager = getVisionManager();
  const { attachVideo, attachStreamToVideo, startCamera, stopCamera } = useVision();
  const [pose, setPose] = useState<PoseResult | null>(null);
  const [repResult, setRepResult] = useState<RepDetectionResult | null>(null);
  const [form, setForm] = useState<ExerciseFormResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<ExerciseFrameDiagnostics | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [poseReady, setPoseReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFrameRef = useRef(onFrame);
  const trackingEnabledRef = useRef(trackingEnabled);
  trackingEnabledRef.current = trackingEnabled;
  onFrameRef.current = onFrame;

  const restartSet = useCallback(() => {
    if (!exercise) return;
    manager.restartExerciseSet(exercise);
  }, [exercise, manager]);

  useEffect(() => {
    installNeutralSpineSessionStore();
  }, []);

  useEffect(() => {
    manager.setExerciseTrackingEnabled(trackingEnabled);
  }, [manager, trackingEnabled]);

  // Kept by the form monitor across sessions, so it can be set before the camera starts.
  useEffect(() => {
    manager.setExerciseFormView(formView);
  }, [formView, manager]);

  useEffect(() => {
    if (!cameraEnabled || !exercise) {
      manager.stopExerciseSession();
      setPose(null);
      setRepResult(null);
      setForm(null);
      setDiagnostics(null);
      setPoseReady(false);
      setCameraReady(false);
      return;
    }

    let cancelled = false;
    let retained = false;
    const video = videoRef.current;

    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
    };

    const start = async () => {
      try {
        setError(null);
        if (!video) {
          fail(PATIENT_ERRORS.camera);
          return;
        }
        attachVideo(video);
        // External camera first. The laptop camera is the fallback.
        const stream = await startCamera(null);
        retained = true;
        if (cancelled) {
          stopCamera();
          retained = false;
          return;
        }
        await attachStreamToVideo(video, stream);
        if (cancelled) return;
        setCameraReady(true);
        manager.setExerciseTrackingEnabled(trackingEnabledRef.current);
        await manager.startExerciseSession(exercise);
        if (cancelled) return;
        setPoseReady(true);
      } catch (err) {
        if (cancelled) return;
        fail(toPatientCameraError(err));
      }
    };

    void start();

    const unsubscribe = manager.subscribeExerciseFrame((payload) => {
      setPose(payload.pose);
      setRepResult(payload.result);
      setForm(payload.form ?? null);
      setDiagnostics(payload.diagnostics ?? null);
      onFrameRef.current?.(payload);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      manager.stopExerciseSession();
      if (retained) stopCamera();
      setCameraReady(false);
      setPoseReady(false);
      if (video) video.srcObject = null;
    };
  }, [
    attachStreamToVideo,
    attachVideo,
    cameraEnabled,
    exercise,
    manager,
    startCamera,
    stopCamera,
    videoRef,
  ]);

  return {
    pose,
    repResult,
    form,
    diagnostics,
    cameraReady,
    poseReady,
    error,
    restartSet,
  };
}
