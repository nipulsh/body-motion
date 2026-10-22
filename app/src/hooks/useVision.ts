import { useCallback, useEffect, useState } from 'react';
import {
  getVisionManager,
  userMessageForVisionError,
  type CameraDevice,
  type ScanGuidance,
  type VisionSnapshot,
} from '@vision';

export function guidanceToCopy(guidance: ScanGuidance): string {
  switch (guidance) {
    case 'POSITION_BODY':
      return 'Make sure your head, shoulders, and hips are visible.';
    case 'READY':
      return 'Slowly rotate a full turn. Hold your arms slightly away from your body.';
    case 'TURN_LEFT':
      return 'Good. Continue rotating smoothly to your left.';
    case 'KEEP_TURNING':
      return 'Halfway there. Keep turning until you complete the circle.';
    case 'SLOW_DOWN':
      return 'Turn a bit slower so each angle stays sharp.';
    case 'BODY_NOT_VISIBLE':
      return 'Step back so your full body stays in frame.';
    case 'SCAN_COMPLETE':
      return 'Scan complete.';
    default: {
      const _never: never = guidance;
      return _never;
    }
  }
}

export function isHighPriorityGuidance(guidance: ScanGuidance): boolean {
  switch (guidance) {
    case 'SLOW_DOWN':
    case 'BODY_NOT_VISIBLE':
      return true;
    case 'POSITION_BODY':
    case 'READY':
    case 'TURN_LEFT':
    case 'KEEP_TURNING':
    case 'SCAN_COMPLETE':
      return false;
    default: {
      const _never: never = guidance;
      return _never;
    }
  }
}

export function useVision() {
  const manager = getVisionManager();
  const [snapshot, setSnapshot] = useState<VisionSnapshot>(() => manager.getState());
  const [devices, setDevices] = useState<CameraDevice[]>([]);

  useEffect(() => {
    setSnapshot(manager.getState());
    return manager.subscribe(({ state }) => {
      setSnapshot(state);
    });
  }, [manager]);

  const listDevices = useCallback(async () => {
    const list = await manager.listDevices();
    setDevices(list);
    return list;
  }, [manager]);

  const attachVideo = useCallback(
    (video: HTMLVideoElement) => manager.attachVideo(video),
    [manager],
  );
  const attachStreamToVideo = useCallback(
    (video: HTMLVideoElement, stream: MediaStream) => manager.attachStreamToVideo(video, stream),
    [manager],
  );
  const startCamera = useCallback(
    (deviceId?: string | null) => manager.startCamera(deviceId),
    [manager],
  );
  const stopCamera = useCallback(() => manager.stopCamera(), [manager]);
  const setScanCaptureMode = useCallback(
    (mode: Parameters<typeof manager.setScanCaptureMode>[0]) => manager.setScanCaptureMode(mode),
    [manager],
  );
  const startScan = useCallback(() => manager.startScan(), [manager]);
  const pauseScan = useCallback(() => manager.pauseScan(), [manager]);
  const resumeScan = useCallback(() => manager.resumeScan(), [manager]);
  const stopScan = useCallback(() => manager.stopScan(), [manager]);
  const getScanResult = useCallback(() => manager.getScanResult(), [manager]);

  const visionErrorMessage = snapshot.error
    ? snapshot.error.message
    : snapshot.scanState === 'error'
      ? userMessageForVisionError('SCAN_FAILED')
      : null;

  return {
    scanCaptureMode: snapshot.scanCaptureMode,
    scanState: snapshot.scanState,
    guidance: snapshot.guidance,
    orientation: snapshot.orientation,
    rotation: snapshot.rotation,
    rotationProgress: snapshot.rotation?.rotationProgress ?? 0,
    rotationDegrees: Math.abs(snapshot.rotation?.cumulativeRotation ?? 0),
    capturedCount: snapshot.capturedCount,
    targetCount: snapshot.targetCount,
    capturedImages: snapshot.capturedImages,
    quality: snapshot.quality,
    cameraReady: snapshot.cameraReady,
    poseReady: snapshot.poseReady,
    error: snapshot.error,
    visionErrorMessage,
    lastEvent: snapshot.lastEvent,
    debugRotation: snapshot.debugRotation,
    devices,
    attachVideo,
    attachStreamToVideo,
    startCamera,
    stopCamera,
    listDevices,
    setScanCaptureMode,
    startScan,
    pauseScan,
    resumeScan,
    stopScan,
    getScanResult,
  };
}
