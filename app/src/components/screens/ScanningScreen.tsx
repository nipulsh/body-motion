import { useEffect, useRef, useState } from 'react';
import { userMessageForVisionError, VisionError } from '@vision';
import { guidanceToCopy, isHighPriorityGuidance, useVision } from '../../hooks/useVision';
import { useVoiceInstructions } from '../../hooks/useVoiceInstructions';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';

interface CapturePreview {
  url: string;
  angleDeg: number;
}

export function ScanningScreen() {
  const { dispatch, state } = useWorkflow();
  const videoRef = useRef<HTMLVideoElement>(null);
  const completedRef = useRef(false);
  const {
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
    capturedCount,
    capturedImages,
    targetCount,
    rotationDegrees,
    debugRotation,
    error,
  } = useVision();
  const [instruction, setInstruction] = useState('Preparing scan…');
  const [previews, setPreviews] = useState<CapturePreview[]>([]);
  const { speak, cancel } = useVoiceInstructions(true);
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const scanSessionReadyRef = useRef(false);
  const isTimedBurst = state.scanCaptureMode === 'TIMED_BURST';

  useEffect(() => {
    setScanCaptureMode(state.scanCaptureMode);
  }, [setScanCaptureMode, state.scanCaptureMode]);

  useEffect(() => {
    setPreviews((prev) => {
      if (capturedImages.length === 0) {
        for (const item of prev) URL.revokeObjectURL(item.url);
        return [];
      }
      if (capturedImages.length < prev.length) {
        for (const item of prev) URL.revokeObjectURL(item.url);
        return capturedImages.map((img) => ({
          url: URL.createObjectURL(img.blob),
          angleDeg: img.angleDeg,
        }));
      }
      if (capturedImages.length === prev.length) return prev;
      const next = [...prev];
      for (let i = prev.length; i < capturedImages.length; i++) {
        const img = capturedImages[i]!;
        next.push({
          url: URL.createObjectURL(img.blob),
          angleDeg: img.angleDeg,
        });
      }
      return next;
    });
  }, [capturedImages]);

  useEffect(() => {
    return () => {
      setPreviews((prev) => {
        for (const item of prev) URL.revokeObjectURL(item.url);
        return [];
      });
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      dispatch({
        type: 'SET_ERROR',
        error: {
          title: 'Camera not ready',
          message: 'Return to camera setup and try again.',
          retryStage: 'camera_setup',
        },
      });
      return;
    }

    let cancelled = false;
    let retained = false;
    scanSessionReadyRef.current = false;
    completedRef.current = false;
    dispatch({ type: 'RESET_CAPTURES' });
    dispatch({ type: 'SET_CAPTURE_PROGRESS', current: 0, target: targetCount });

    const fail = (message: string, technical?: string) => {
      dispatch({
        type: 'SET_ERROR',
        error: {
          title: 'Scan interrupted',
          message,
          technical,
          retryStage: 'camera_setup',
        },
      });
    };

    const start = async () => {
      try {
        attachVideo(video);
        const stream = await startCamera(state.cameraDeviceId);
        retained = true;
        if (cancelled) {
          stopCamera();
          retained = false;
          return;
        }

        await attachStreamToVideo(video, stream);
        if (cancelled) return;

        await startScan();
        if (cancelled) return;
        scanSessionReadyRef.current = true;
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        const technical = err instanceof Error ? err.message : String(err);
        fail(
          err instanceof VisionError
            ? userMessageForVisionError(err.code)
            : 'Could not start the camera for this scan. Return to camera setup and try again.',
          technical,
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      scanSessionReadyRef.current = false;
      stopScan();
      if (retained) stopCamera();
      cancel();
      video.srcObject = null;
    };
  }, [
    attachStreamToVideo,
    attachVideo,
    cancel,
    dispatch,
    startCamera,
    startScan,
    state.cameraDeviceId,
    stopCamera,
    stopScan,
    targetCount,
  ]);

  useEffect(() => {
    dispatch({
      type: 'SET_CAPTURE_PROGRESS',
      current: capturedCount,
      target: targetCount,
    });
    dispatch({ type: 'SET_ROTATION_PROGRESS', degrees: rotationDegrees });
  }, [capturedCount, dispatch, rotationDegrees, targetCount]);

  useEffect(() => {
    if (!guidance) return;
    let text = guidanceToCopy(guidance);
    if (isTimedBurst && guidance === 'READY') {
      text = 'Stand still and face the camera. Capturing for 8 seconds.';
    }
    if (isTimedBurst && guidance === 'SCAN_COMPLETE') {
      text = 'Capture complete.';
    }
    setInstruction(text);
    speakRef.current(text, isHighPriorityGuidance(guidance) ? { priority: 'high' } : undefined);
  }, [guidance, isTimedBurst]);

  useEffect(() => {
    if (scanState !== 'error' || !error) return;
    dispatch({
      type: 'SET_ERROR',
      error: {
        title: 'Scan interrupted',
        message: error.message,
        technical: error.code,
        retryStage: 'camera_setup',
      },
    });
  }, [dispatch, error, scanState]);

  useEffect(() => {
    if (!scanSessionReadyRef.current) return;
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
    cancel();
    dispatch({ type: 'SET_STAGE', stage: 'uploading' });
  }, [cancel, dispatch, getScanResult, scanState]);

  const { current, target } = state.captureProgress;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title={isTimedBurst ? 'Analysis capture' : '360° scan'}
        description={instruction}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* min-w-0: prevent the thumbnail strip from expanding the grid column
            (and thus the aspect-ratio camera) as captures accumulate. */}
        <div className="min-w-0 space-y-4">
          <div className="camera-preview-wrap large w-full max-w-full overflow-hidden rounded-xl border">
            <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
            <div className="silhouette-guide" aria-hidden />
            {!isTimedBurst && debugRotation ? (
              <pre className="rotation-debug-overlay" aria-hidden>
                {`Raw orientation: ${debugRotation.rawAngle.toFixed(1)}°
Smoothed orientation: ${debugRotation.smoothedAngle.toFixed(1)}°
Unwrapped orientation: ${debugRotation.unwrappedAngle.toFixed(1)}°
Cumulative rotation: ${debugRotation.cumulativeRotation.toFixed(1)}°
Rotation progress: ${Math.round(debugRotation.rotationProgress * 100)}%
Direction: ${debugRotation.direction}
Pose confidence: ${Math.round(debugRotation.poseConfidence * 100)}%
Orientation confidence: ${Math.round(debugRotation.orientationConfidence * 100)}%
Frame delta: ${debugRotation.frameDelta >= 0 ? '+' : ''}${debugRotation.frameDelta.toFixed(1)}°`}
              </pre>
            ) : null}
          </div>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Captured images
                {previews.length > 0 ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {previews.length} so far
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              {previews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {isTimedBurst
                    ? 'Thumbnails appear here as each frame is captured.'
                    : 'Thumbnails appear here as each angle is captured.'}
                </p>
              ) : (
                <div className="w-full max-w-full overflow-x-auto">
                  <ul className="flex w-max gap-2 pb-2">
                    {previews.map((item, index) => (
                      <li
                        key={item.url}
                        className="inline-flex w-[88px] shrink-0 flex-col gap-1"
                      >
                        <img
                          src={item.url}
                          alt={
                            isTimedBurst
                              ? `Frame ${index + 1}`
                              : `Capture ${index + 1} at ${Math.round(item.angleDeg)} degrees`
                          }
                          className="aspect-[3/4] w-full rounded-md border object-cover"
                        />
                        <span className="text-center text-xs text-muted-foreground">
                          {isTimedBurst ? `#${index + 1}` : `${Math.round(item.angleDeg)}°`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-sm text-muted-foreground">Captures</p>
              <p className="text-3xl font-semibold tracking-tight">
                {current} / {target}
              </p>
            </div>
            {!isTimedBurst ? (
              <div>
                <p className="text-sm text-muted-foreground">Rotation</p>
                <p className="text-3xl font-semibold tracking-tight">
                  {Math.round(state.rotationProgress)}°
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="text-3xl font-semibold tracking-tight">8s @ 10 FPS</p>
              </div>
            )}
            <Progress value={Math.min(100, (current / Math.max(target, 1)) * 100)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
