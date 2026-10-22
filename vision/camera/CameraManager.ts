import { VISION_CONFIG } from '../config';
import { VisionError, wrapCameraError } from '../errors';
import type { CameraDevice } from '../types';
import {
  camerasInPreferenceOrder,
  isBuiltinCamera,
  isSkippedCamera,
  pickPreferredCamera,
} from './preferredCamera';

function isStreamLive(stream: MediaStream | null | undefined): stream is MediaStream {
  return Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'));
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function cameraConstraints(deviceId?: string | null): MediaStreamConstraints {
  const { width, height } = VISION_CONFIG.camera;
  return {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height } }
      : { facingMode: 'user', width: { ideal: width }, height: { ideal: height } },
    audio: false,
  };
}

async function getUserMediaWithRetry(
  deviceId?: string | null,
  fallbackDeviceIds: readonly string[] = [],
): Promise<MediaStream> {
  const open = (id?: string | null) => navigator.mediaDevices.getUserMedia(cameraConstraints(id));

  const tryDevice = async (id?: string | null): Promise<MediaStream> => {
    try {
      return await open(id);
    } catch (err) {
      const notReadable = err instanceof DOMException && err.name === 'NotReadableError';
      if (!notReadable) throw err;
      await new Promise((resolve) => setTimeout(resolve, VISION_CONFIG.camera.notReadableRetryMs));
      try {
        return await open(id);
      } catch {
        throw err;
      }
    }
  };

  const tried = new Set<string>();
  const candidates: Array<string | null | undefined> = [deviceId, ...fallbackDeviceIds];
  if (deviceId || fallbackDeviceIds.length > 0) candidates.push(null);

  let lastError: unknown;
  for (const id of candidates) {
    const key = id ?? '';
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      return await tryDevice(id);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Unable to start the camera.');
}

export class CameraManager {
  private activeStream: MediaStream | null = null;
  private activeDeviceId: string | null | undefined;
  private retainCount = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;

  isLive(): boolean {
    return isStreamLive(this.activeStream);
  }

  getStream(): MediaStream | null {
    return isStreamLive(this.activeStream) ? this.activeStream : null;
  }

  getDeviceId(): string | null {
    return this.activeDeviceId ?? null;
  }

  async listDevices(): Promise<CameraDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new VisionError('UNSUPPORTED', 'Camera API is not available.');
    }

    const enumerate = async (): Promise<CameraDevice[]> => {
      const list = await navigator.mediaDevices.enumerateDevices();
      return list
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    };

    try {
      let devices = await enumerate();
      const needsProbe = devices.length === 0 || devices.every((d) => !d.label);
      if (needsProbe && !this.isLive()) {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((track) => track.stop());
        devices = await enumerate();
      }
      return camerasInPreferenceOrder(devices);
    } catch (err) {
      throw wrapCameraError(err);
    }
  }

  /**
   * The laptop camera is the labeled built-in device, or the camera selected by
   * facingMode "user" when the label does not say it is built in.
   */
  private async laptopDeviceId(
    devices: readonly { deviceId: string; label: string }[],
  ): Promise<string | null> {
    const labeled = devices.find(
      (device) => device.deviceId && isBuiltinCamera(device.label) && !isSkippedCamera(device.label),
    );
    if (labeled) return labeled.deviceId;
    const real = devices.filter((device) => device.deviceId && !isSkippedCamera(device.label));
    if (real.length < 2 || this.isLive()) return null;
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      const id = probe.getVideoTracks()[0]?.getSettings().deviceId ?? null;
      stopMediaStream(probe);
      return id;
    } catch {
      return null;
    }
  }

  async retain(deviceId?: string | null): Promise<MediaStream> {
    this.retainCount += 1;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }

    try {
      let requestedId = deviceId ?? null;
      let fallbackIds: string[] = [];
      try {
        const devices = await this.listDevices();
        const preference = { builtinDeviceId: await this.laptopDeviceId(devices) };
        if (!deviceId) {
          requestedId = pickPreferredCamera(devices, preference)?.deviceId ?? null;
        }
        fallbackIds = camerasInPreferenceOrder(devices, preference)
          .map((device) => device.deviceId)
          .filter((id) => id && id !== requestedId);
      } catch {
        if (!deviceId) requestedId = null;
        fallbackIds = [];
      }

      const liveDeviceId =
        this.activeStream?.getVideoTracks()[0]?.getSettings().deviceId ?? this.activeDeviceId ?? null;
      const sameDevice = !requestedId || !liveDeviceId || requestedId === liveDeviceId;
      if (isStreamLive(this.activeStream) && sameDevice) return this.activeStream;

      stopMediaStream(this.activeStream);
      this.activeStream = null;
      this.activeStream = await getUserMediaWithRetry(requestedId, fallbackIds);
      this.activeDeviceId =
        this.activeStream.getVideoTracks()[0]?.getSettings().deviceId ?? requestedId ?? null;
      return this.activeStream;
    } catch (err) {
      this.retainCount = Math.max(0, this.retainCount - 1);
      throw wrapCameraError(err);
    }
  }

  release(): void {
    this.retainCount = Math.max(0, this.retainCount - 1);
    if (this.retainCount > 0) return;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      if (this.retainCount > 0) return;
      stopMediaStream(this.activeStream);
      this.activeStream = null;
      this.activeDeviceId = null;
    }, VISION_CONFIG.camera.cameraReleaseDelayMs);
  }

  async attachToVideo(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      throw wrapCameraError(err);
    }
  }

  stopNow(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    this.retainCount = 0;
    stopMediaStream(this.activeStream);
    this.activeStream = null;
    this.activeDeviceId = null;
  }
}
