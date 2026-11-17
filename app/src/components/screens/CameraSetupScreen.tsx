import { useEffect, useRef, useState } from 'react';
import { pickPreferredCamera, userMessageForVisionError, VisionError } from '@vision';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { useVision } from '../../hooks/useVision';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { PageHeader } from '../layout/PageHeader';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export function CameraSetupScreen() {
  const { dispatch, state } = useWorkflow();
  const { isOnline, offlineMessage } = useRequiresOnline();
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    devices,
    listDevices,
    attachVideo,
    attachStreamToVideo,
    startCamera,
    stopCamera,
  } = useVision();
  const [deviceId, setDeviceId] = useState<string>('');
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDevices()
      .then((cams) => {
        if (cancelled) return;
        setDeviceId(pickPreferredCamera(cams)?.deviceId || '');
      })
      .catch((err: unknown) => {
        console.error(err);
        if (cancelled) return;
        if (err instanceof VisionError) {
          setError(userMessageForVisionError(err.code));
          return;
        }
        setError('Unable to access camera devices.');
      });

    return () => {
      cancelled = true;
    };
  }, [listDevices]);

  useEffect(() => {
    if (!deviceId) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let retained = false;

    const startPreview = async () => {
      setError(null);
      setPreviewReady(false);
      try {
        attachVideo(video);
        const stream = await startCamera(deviceId);
        retained = true;
        if (cancelled) {
          stopCamera();
          retained = false;
          return;
        }
        await attachStreamToVideo(video, stream);
        if (!cancelled) setPreviewReady(true);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(
            err instanceof VisionError
              ? userMessageForVisionError(err.code)
              : 'Camera access is required. Check permissions and try again.',
          );
        }
      }
    };

    void startPreview();

    return () => {
      cancelled = true;
      if (retained) stopCamera();
      video.srcObject = null;
    };
  }, [attachStreamToVideo, attachVideo, deviceId, startCamera, stopCamera]);

  const isTimedBurst = state.scanCaptureMode === 'TIMED_BURST';

  const continueToScan = () => {
    if (!isOnline) {
      setError(offlineMessage);
      return;
    }
    if (!previewReady) {
      setError('Start the camera preview before continuing.');
      return;
    }
    dispatch({ type: 'SET_CAMERA_DEVICE', deviceId: deviceId || null });
    dispatch({ type: 'RESET_CAPTURES' });
    dispatch({ type: 'SET_STAGE', stage: 'scanning' });
  };

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Camera setup"
        description={
          isTimedBurst
            ? 'Center the patient, full body visible. The next step takes 10 pictures facing the camera, then 10 turned right and 10 with the back to the camera.'
            : 'Position the patient centered, full body visible, with even lighting.'
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="camera-preview-wrap overflow-hidden rounded-xl border">
          <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
          <div className="silhouette-guide" aria-hidden />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {devices.length > 1 ? (
              <div className="space-y-2">
                <Label>Camera</Label>
                <Select value={deviceId} onValueChange={setDeviceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {!isOnline ? (
              <Alert variant="destructive">
                <AlertDescription>{offlineMessage}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="button" className="w-full" disabled={!isOnline} onClick={continueToScan}>
              Begin 360° scan
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'dashboard' })}
            >
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
