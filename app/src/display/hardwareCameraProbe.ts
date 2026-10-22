import { cameraConstraints } from '@vision/camera/CameraManager';
import { isBuiltinCamera, isSkippedCamera, pickPreferredCamera } from '@vision/camera/preferredCamera';
import type { CameraDevice } from '@vision/types';

export interface CameraProbeDevice {
  kind: string;
  deviceId: string;
  label: string;
}

export interface CameraProbeDependencies {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices: () => Promise<readonly CameraProbeDevice[]>;
  readVideoSize?: (stream: MediaStream) => Promise<{ width: number; height: number } | null>;
}

export type CameraProbeResult =
  | {
      ok: true;
      deviceId: string | null;
      label: string | null;
      width: number | null;
      height: number | null;
    }
  | {
      ok: false;
      message: string;
    };

function positiveSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string') {
    return err.name;
  }
  return '';
}

function cameraErrorMessage(err: unknown): string {
  const name = errorName(err);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No webcam was found.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The webcam is in use or could not be opened.';
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return 'The webcam could not be opened.';
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

async function defaultReadVideoSize(stream: MediaStream): Promise<{ width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1 && video.videoWidth > 0) {
        resolve();
        return;
      }
      const finish = () => resolve();
      video.addEventListener('loadedmetadata', finish, { once: true });
      void video.play().catch(finish);
    });
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return { width: video.videoWidth, height: video.videoHeight };
    }
    return null;
  } finally {
    video.srcObject = null;
  }
}

async function selectExternalWebcam(
  enumerateDevices: CameraProbeDependencies['enumerateDevices'],
  getUserMedia: CameraProbeDependencies['getUserMedia'],
): Promise<{ deviceId: string } | { message: string }> {
  let cameras = videoCameras(await enumerateDevices());
  if (cameras.length === 0 || cameras.every((camera) => !camera.label.trim())) {
    const granted = await grantCameraPermission(getUserMedia);
    if ('message' in granted) return granted;
    cameras = videoCameras(await enumerateDevices());
  }

  const real = cameras.filter((camera) => camera.deviceId && !isSkippedCamera(camera.label));
  const labeledLaptop = real.find((camera) => isBuiltinCamera(camera.label))?.deviceId ?? null;
  const builtinDeviceId = labeledLaptop ?? (real.length >= 2 ? await facingModeLaptopId(getUserMedia) : null);
  if (real.length >= 2 && !builtinDeviceId) {
    return {
      message: 'Could not tell the external webcam from the laptop camera. Connect the external webcam and refresh.',
    };
  }

  const preferred = pickPreferredCamera(cameras, { builtinDeviceId });
  if (!preferred?.deviceId || (builtinDeviceId && preferred.deviceId === builtinDeviceId) || isBuiltinCamera(preferred?.label ?? '')) {
    return { message: real.length === 0 ? 'No webcam was found.' : EXTERNAL_WEBCAM_MISSING };
  }
  return { deviceId: preferred.deviceId };
}

function videoCameras(devices: readonly CameraProbeDevice[]): CameraDevice[] {
  return devices
    .filter((device) => device.kind === 'videoinput' && device.deviceId)
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
}

async function grantCameraPermission(
  getUserMedia: CameraProbeDependencies['getUserMedia'],
): Promise<{ ok: true } | { message: string }> {
  let stream: MediaStream | null = null;
  try {
    stream = await getUserMedia({ video: true, audio: false });
    return { ok: true };
  } catch (err) {
    return { message: cameraErrorMessage(err) };
  } finally {
    if (stream) stopStream(stream);
  }
}

/** Same check CameraManager uses when the laptop webcam's label is generic. */
async function facingModeLaptopId(
  getUserMedia: CameraProbeDependencies['getUserMedia'],
): Promise<string | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await getUserMedia({ video: { facingMode: 'user' }, audio: false });
    const id = stream.getVideoTracks()[0]?.getSettings().deviceId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  } finally {
    if (stream) stopStream(stream);
  }
}

function browserDependencies(): CameraProbeDependencies | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return null;
  const media = navigator.mediaDevices;
  if (!media.getUserMedia || !media.enumerateDevices) return null;
  return {
    getUserMedia: (constraints) => media.getUserMedia(constraints),
    enumerateDevices: () => media.enumerateDevices(),
  };
}

const EXTERNAL_WEBCAM_MISSING =
  'The external mirror webcam was not found. This diagnostic does not use the laptop camera.';

/**
 * Opens the external mirror webcam, reads the size that device negotiated, then
 * stops every track. The laptop camera is identified the same way as the mirror
 * session (built-in label, or the facingMode "user" device when labels match)
 * and is never the camera that gets measured.
 */
export async function probeHardwareCamera(
  dependencies?: Partial<CameraProbeDependencies>,
): Promise<CameraProbeResult> {
  const defaults = browserDependencies();
  const getUserMedia = dependencies?.getUserMedia ?? defaults?.getUserMedia;
  const enumerateDevices = dependencies?.enumerateDevices ?? defaults?.enumerateDevices;
  const readVideoSize = dependencies?.readVideoSize ?? defaultReadVideoSize;
  if (!getUserMedia || !enumerateDevices) {
    return { ok: false, message: 'Camera access is not available in this window.' };
  }

  let stream: MediaStream | null = null;
  try {
    const selected = await selectExternalWebcam(enumerateDevices, getUserMedia);
    if ('message' in selected) return { ok: false, message: selected.message };
    stream = await getUserMedia(cameraConstraints(selected.deviceId));
    const track = stream.getVideoTracks()[0];
    if (!track) return { ok: false, message: 'No webcam was found.' };

    const settings = track.getSettings();
    let width = positiveSize(settings.width);
    let height = positiveSize(settings.height);
    if (width == null || height == null) {
      const size = await readVideoSize(stream);
      if (width == null) width = positiveSize(size?.width);
      if (height == null) height = positiveSize(size?.height);
    }

    const reportedId = typeof settings.deviceId === 'string' && settings.deviceId ? settings.deviceId : selected.deviceId;
    if (reportedId !== selected.deviceId) {
      return { ok: false, message: EXTERNAL_WEBCAM_MISSING };
    }
    const deviceId = reportedId;
    const named = deviceId
      ? (await enumerateDevices()).find((device) => device.kind === 'videoinput' && device.deviceId === deviceId)
      : undefined;
    const label = named?.label.trim() ? named.label.trim() : null;

    return { ok: true, deviceId, label, width, height };
  } catch (err) {
    return { ok: false, message: cameraErrorMessage(err) };
  } finally {
    if (stream) stopStream(stream);
  }
}
