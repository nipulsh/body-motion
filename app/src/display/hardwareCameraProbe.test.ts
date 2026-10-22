import { describe, expect, it } from 'vitest';
import { probeHardwareCamera, type CameraProbeDevice } from './hardwareCameraProbe';

function streamFrom(settings: MediaTrackSettings, stopped: { value: boolean }) {
  const track = {
    getSettings: () => settings,
    stop: () => {
      stopped.value = true;
    },
  };
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

const usbAndLaptop: CameraProbeDevice[] = [
  { kind: 'videoinput', deviceId: 'laptop', label: 'Integrated Camera' },
  { kind: 'videoinput', deviceId: 'usb-cam', label: 'Logitech BRIO' },
];

describe('probeHardwareCamera', () => {
  it('reports the negotiated size and stops the track', async () => {
    const stopped = { value: false };
    const captured: { constraints: MediaStreamConstraints | null } = { constraints: null };
    const result = await probeHardwareCamera({
      enumerateDevices: async () => usbAndLaptop,
      getUserMedia: async (constraints) => {
        captured.constraints = constraints;
        return streamFrom({ width: 1920, height: 1080, deviceId: 'usb-cam' }, stopped);
      },
    });

    expect(result).toEqual({
      ok: true,
      deviceId: 'usb-cam',
      label: 'Logitech BRIO',
      width: 1920,
      height: 1080,
    });
    const video = captured.constraints?.video;
    expect(video && typeof video === 'object' && 'deviceId' in video ? video.deviceId : null).toEqual({
      exact: 'usb-cam',
    });
    expect(stopped.value).toBe(true);
  });

  it('does not invent 1280×720 when the camera omits its size', async () => {
    const stopped = { value: false };
    const result = await probeHardwareCamera({
      enumerateDevices: async () => usbAndLaptop,
      getUserMedia: async () => streamFrom({ deviceId: 'usb-cam' }, stopped),
      readVideoSize: async () => null,
    });

    expect(result).toMatchObject({ ok: true, width: null, height: null, deviceId: 'usb-cam' });
    expect(stopped.value).toBe(true);
  });

  it('skips the laptop when both cameras have a generic USB label', async () => {
    const stoppedLaptop = { value: false };
    const stoppedExternal = { value: false };
    const opened: MediaStreamConstraints[] = [];
    const result = await probeHardwareCamera({
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'laptop', label: 'USB Video Device' },
        { kind: 'videoinput', deviceId: 'usb-cam', label: 'USB Video Device' },
      ],
      getUserMedia: async (constraints) => {
        opened.push(constraints);
        const video = constraints.video;
        const facingMode = video && typeof video === 'object' && 'facingMode' in video ? video.facingMode : null;
        if (facingMode === 'user') return streamFrom({ deviceId: 'laptop' }, stoppedLaptop);
        return streamFrom({ width: 1280, height: 720, deviceId: 'usb-cam' }, stoppedExternal);
      },
    });

    expect(result).toMatchObject({ ok: true, deviceId: 'usb-cam', label: 'USB Video Device', width: 1280, height: 720 });
    expect(opened.some((constraints) => {
      const video = constraints.video;
      return Boolean(video && typeof video === 'object' && 'deviceId' in video && video.deviceId && typeof video.deviceId === 'object' && 'exact' in video.deviceId && video.deviceId.exact === 'laptop');
    })).toBe(false);
    expect(stoppedLaptop.value).toBe(true);
    expect(stoppedExternal.value).toBe(true);
  });

  it('does not open the laptop camera when it is the only camera', async () => {
    let opened = 0;
    const result = await probeHardwareCamera({
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'laptop', label: 'HP Wide Vision HD Camera' },
      ],
      getUserMedia: async () => {
        opened += 1;
        throw new Error('should not open');
      },
    });

    expect(opened).toBe(0);
    expect(result).toEqual({
      ok: false,
      message: 'The external mirror webcam was not found. This diagnostic does not use the laptop camera.',
    });
  });

  it('reports a missing webcam without a resolution', async () => {
    const result = await probeHardwareCamera({
      enumerateDevices: async () => [],
      getUserMedia: async () => {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      },
    });

    expect(result).toEqual({ ok: false, message: 'No webcam was found.' });
  });
});
