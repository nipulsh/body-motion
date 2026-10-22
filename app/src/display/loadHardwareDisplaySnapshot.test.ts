import { describe, expect, it } from 'vitest';
import type { DesktopBridge } from '../desktop/desktopApi';
import { DESKTOP_DISPLAY_SNAPSHOT_URL } from './displaySnapshotPayload';
import { loadHardwareDisplaySnapshot } from './loadDisplays';

const snapshotPayload = {
  runtimeAvailable: true,
  topology: 'extend',
  monitors: [
    { name: 'Laptop', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, rotation: 0 },
    { name: 'TV', x: 1920, y: 0, width: 1080, height: 1920, scaleFactor: 1, rotation: 90 },
  ],
  primary: { name: 'Laptop', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, rotation: 0 },
};

describe('loadHardwareDisplaySnapshot', () => {
  it('reads the IPC payload from the desktop bridge', async () => {
    const bridge = {
      getDisplaySnapshot: async () => snapshotPayload,
    } as unknown as DesktopBridge;

    const snapshot = await loadHardwareDisplaySnapshot({ bridge });
    const tv = snapshot.displays.find((display) => display.name === 'TV');
    expect(tv).toMatchObject({ width: 1080, height: 1920, orientation: 'portrait', rotation: 90 });
  });

  it('reports an IPC failure instead of inventing a display', async () => {
    const bridge = {
      getDisplaySnapshot: async () => {
        throw new Error('display channel closed');
      },
    } as unknown as DesktopBridge;

    await expect(loadHardwareDisplaySnapshot({ bridge })).rejects.toThrow('display channel closed');
  });

  it('reads the localhost snapshot when the page is not the desktop window', async () => {
    const requested: string[] = [];
    const fetchSnapshot = (async (url: string) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => snapshotPayload,
      } as Response;
    }) as typeof fetch;

    const snapshot = await loadHardwareDisplaySnapshot({ bridge: null, fetchSnapshot });
    expect(requested).toEqual([DESKTOP_DISPLAY_SNAPSHOT_URL]);
    expect(snapshot.displays.find((display) => display.name === 'TV')?.height).toBe(1920);
  });

  it('explains when the desktop app is not running', async () => {
    const fetchSnapshot = (async () => {
      throw new Error('connection refused');
    }) as typeof fetch;

    await expect(loadHardwareDisplaySnapshot({ bridge: null, fetchSnapshot })).rejects.toThrow(
      'The desktop app is not running',
    );
  });

  it('rejects a snapshot that omits the display size', async () => {
    const fetchSnapshot = (async () => ({
      ok: true,
      json: async () => ({
        ...snapshotPayload,
        monitors: snapshotPayload.monitors.map((monitor) => (
          monitor.name === 'TV' ? { ...monitor, width: null } : monitor
        )),
      }),
    })) as unknown as typeof fetch;

    await expect(loadHardwareDisplaySnapshot({ bridge: null, fetchSnapshot })).rejects.toThrow('Display width');
  });
});
