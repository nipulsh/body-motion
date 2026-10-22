import { useCallback, useEffect, useRef, useState } from 'react';
import { pickPreferredCamera, userMessageForVisionError, VisionError } from '@vision';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { guidanceToCopy, isHighPriorityGuidance, useVision } from '../../hooks/useVision';
import { useVoiceInstructions } from '../../hooks/useVoiceInstructions';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import {
  MIRROR_SCAN_COUNTDOWN_MS,
  MIRROR_SCAN_INSTRUCTION,
  MIRROR_SCAN_INSTRUCTION_HOLD_MS,
  type MirrorScanCountdownStep,
  nextMirrorScanCountdownStep,
} from '../smartMirror/mirrorScanPreamble';
import { useMirrorHandNav } from '../smartMirror/MirrorHandNavContext';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const mirrorControlButtonClass =
  'h-auto min-h-9 rounded-lg border border-black bg-white px-4 py-1.5 text-sm font-medium text-black shadow-none hover:bg-neutral-50';

/**
 * Off-screen but large enough that the decoder still produces frames for timed capture.
 * Same approach as the exercise session camera.
 */
const HIDDEN_CAMERA_CLASS =
  'pointer-events-none fixed -left-[9999px] top-0 h-[480px] w-[640px] opacity-0';

type AnalysisPhase = 'idle' | 'prep' | 'countdown' | 'scanning';

export function SmartMirrorAnalysisScreen() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const completedRef = useRef(false);
  const scanSessionReadyRef = useRef(false);
  const captureCameraRetainedRef = useRef(false);
  const { state, dispatch } = useWorkflow();
  const { isOnline, offlineMessage } = useRequiresOnline();
  const { setAnalysisCaptureActive } = useMirrorHandNav();
  const [phase, setPhase] = useState<AnalysisPhase>('idle');
  const [countdownStep, setCountdownStep] = useState<MirrorScanCountdownStep | null>(null);
  const [captureDeviceId, setCaptureDeviceId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const sessionActive = phase !== 'idle';
  const {
    listDevices,
    attachVideo,
    attachStreamToVideo,
    startCamera,
    stopCamera,
    setScanCaptureMode,
    startScan,
    stopScan,
    getScanResult,
    scanState,
    guidance,
    error: visionError,
    targetCount,
  } = useVision();
  const { speak, cancel } = useVoiceInstructions(sessionActive);
  const speakRef = useRef(speak);
  speakRef.current = speak;

  useEffect(() => {
    setScanCaptureMode('TIMED_BURST');
  }, [setScanCaptureMode]);

  useEffect(() => {
    setAnalysisCaptureActive(phase !== 'idle');
    return () => setAnalysisCaptureActive(false);
  }, [phase, setAnalysisCaptureActive]);

  const releaseCamera = useCallback(() => {
    stopScan();
    if (captureCameraRetainedRef.current) {
      stopCamera();
      captureCameraRetainedRef.current = false;
    }
    cancel();
    const video = videoRef.current;
    if (video) video.srcObject = null;
    scanSessionReadyRef.current = false;
    completedRef.current = false;
  }, [cancel, stopCamera, stopScan]);

  const returnHome = useCallback(() => {
    releaseCamera();
    setPhase('idle');
    setCountdownStep(null);
    setCaptureDeviceId(null);
    setLocalError(null);
    dispatch({ type: 'RESET_CAPTURES' });
    dispatch({ type: 'SET_STAGE', stage: 'mirror_home' });
  }, [dispatch, releaseCamera]);

  const failCapture = useCallback(
    (message: string) => {
      releaseCamera();
      setPhase('idle');
      setLocalError(message);
    },
    [releaseCamera],
  );

  const ensurePatientContext = useCallback(() => {
    if (state.patientId && state.patientId !== 'pending') return;
    if (state.activePatient) {
      dispatch({
        type: 'SET_PATIENT',
        patientId: state.activePatient.id,
        name: state.activePatient.fullName,
        patient: state.activePatient,
      });
      return;
    }
    dispatch({
      type: 'SET_PATIENT',
      patientId: 'pending',
      name: 'Mirror Session',
    });
  }, [dispatch, state.activePatient, state.patientId]);

  const handleStart = useCallback(async () => {
    if (!isOnline) {
      setLocalError(offlineMessage);
      return;
    }
    if (sessionActive) return;
    setLocalError(null);
    ensurePatientContext();
    dispatch({ type: 'RESET_CAPTURES' });
    dispatch({ type: 'SET_SCAN', scanId: null });
    dispatch({ type: 'SET_CAPTURE_PROGRESS', current: 0, target: targetCount });

    try {
      const cameras = await listDevices();
      const deviceId = pickPreferredCamera(cameras)?.deviceId ?? '';
      if (!deviceId) {
        setLocalError('No camera found. Connect a camera and try again.');
        return;
      }
      dispatch({ type: 'SET_CAMERA_DEVICE', deviceId });
      setCaptureDeviceId(deviceId);
      setPhase('prep');
    } catch (err) {
      console.error(err);
      setLocalError(
        err instanceof VisionError
          ? userMessageForVisionError(err.code)
          : 'Unable to access camera devices.',
      );
    }
  }, [
    dispatch,
    ensurePatientContext,
    isOnline,
    listDevices,
    offlineMessage,
    sessionActive,
    targetCount,
  ]);

  useEffect(() => {
    if (phase !== 'prep') return;
    speakRef.current(MIRROR_SCAN_INSTRUCTION, { priority: 'high' });
    const timer = window.setTimeout(() => {
      setCountdownStep(3);
      setPhase('countdown');
    }, MIRROR_SCAN_INSTRUCTION_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'countdown' || countdownStep === null) return;
    speakRef.current(String(countdownStep), { priority: 'high' });
    const timer = window.setTimeout(() => {
      const next = nextMirrorScanCountdownStep(countdownStep);
      if (next === null) {
        setCountdownStep(null);
        setPhase('scanning');
      } else {
        setCountdownStep(next);
      }
    }, MIRROR_SCAN_COUNTDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [countdownStep, phase]);

  useEffect(() => {
    if (!captureDeviceId) return;
    const video = videoRef.current;
    if (!video) {
      failCapture('Camera view is not ready. Try again.');
      return;
    }

    let cancelled = false;
    scanSessionReadyRef.current = false;
    completedRef.current = false;

    const start = async () => {
      try {
        attachVideo(video);
        const stream = await startCamera(captureDeviceId);
        captureCameraRetainedRef.current = true;
        if (cancelled) {
          stopCamera();
          captureCameraRetainedRef.current = false;
          return;
        }
        await attachStreamToVideo(video, stream);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        failCapture(
          err instanceof VisionError
            ? userMessageForVisionError(err.code)
            : 'Could not start the camera. Check permissions and try again.',
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      releaseCamera();
    };
  }, [
    attachStreamToVideo,
    attachVideo,
    failCapture,
    captureDeviceId,
    releaseCamera,
    startCamera,
    stopCamera,
  ]);

  useEffect(() => {
    if (phase !== 'scanning' || !captureDeviceId) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const beginScan = async () => {
      try {
        if (scanSessionReadyRef.current) return;
        await startScan();
        if (cancelled) return;
        scanSessionReadyRef.current = true;
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        failCapture(
          err instanceof VisionError
            ? userMessageForVisionError(err.code)
            : 'Could not start the scan. Try again.',
        );
      }
    };

    void beginScan();

    return () => {
      cancelled = true;
    };
  }, [captureDeviceId, failCapture, phase, startScan]);

  useEffect(() => {
    if (phase !== 'scanning' || !guidance) return;
    let text = guidanceToCopy(guidance);
    if (guidance === 'READY') {
      text = 'Stand still and face the camera. Capturing for 8 seconds.';
    }
    if (guidance === 'SCAN_COMPLETE') {
      text = 'Capture complete.';
    }
    speakRef.current(text, isHighPriorityGuidance(guidance) ? { priority: 'high' } : undefined);
  }, [guidance, phase]);

  useEffect(() => {
    if (phase !== 'scanning' || scanState !== 'error' || !visionError) return;
    failCapture(visionError.message);
  }, [failCapture, phase, scanState, visionError]);

  useEffect(() => {
    if (phase !== 'scanning' || !scanSessionReadyRef.current) return;
    if (scanState !== 'completed' || completedRef.current) return;
    const result = getScanResult();
    if (!result) return;
    completedRef.current = true;
    dispatch({ type: 'RESET_CAPTURES' });
    for (const img of result.images) {
      dispatch({
        type: 'ADD_CAPTURE',
        image: { blob: img.blob, angleDeg: img.angleDeg, timestamp: img.timestamp },
      });
    }
    releaseCamera();
    setPhase('idle');
    dispatch({ type: 'SET_STAGE', stage: 'mirror_uploading' });
  }, [dispatch, getScanResult, phase, releaseCamera, scanState]);

  useEffect(() => () => releaseCamera(), [releaseCamera]);

  return (
    <MirrorPortraitCard
      ref={rootRef}
      testId="mirror-analysis-card"
      className="overflow-hidden bg-black"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden
        tabIndex={-1}
        data-testid="mirror-analysis-camera"
        className={HIDDEN_CAMERA_CLASS}
      />
      <div className="flex shrink-0 items-start justify-between gap-3 p-4 sm:p-5">
        <Button
          type="button"
          variant="outline"
          data-testid="mirror-analysis-back"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorControlButtonClass)}
          onClick={returnHome}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!isOnline || sessionActive}
          title={!isOnline ? offlineMessage : undefined}
          data-testid="mirror-analysis-start"
          {...{ [MIRROR_GESTURE_TARGET_ATTR]: 'true' }}
          className={cn(mirrorControlButtonClass)}
          onClick={() => void handleStart()}
        >
          Start
        </Button>
      </div>

      <div
        data-testid="mirror-analysis-viewport"
        className="relative min-h-0 w-full flex-1 overflow-hidden bg-black"
      >
        {phase === 'prep' ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black px-6 text-center"
            data-testid="mirror-analysis-prep-overlay"
          >
            <p className="max-w-lg text-lg font-medium leading-relaxed text-white sm:text-xl">
              {MIRROR_SCAN_INSTRUCTION}
            </p>
          </div>
        ) : null}
        {phase === 'countdown' && countdownStep !== null ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black"
            data-testid="mirror-analysis-countdown-overlay"
            aria-live="assertive"
          >
            <span className="text-[min(28vw,12rem)] font-bold tabular-nums text-white">
              {countdownStep}
            </span>
          </div>
        ) : null}
      </div>

      {localError ? (
        <p className="absolute bottom-4 left-4 right-4 z-10 text-center text-sm text-red-400" role="alert">
          {localError}
        </p>
      ) : null}
    </MirrorPortraitCard>
  );
}
