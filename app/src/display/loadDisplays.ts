import { getDesktopBridge, isDesktopApp, type DesktopBridge } from '../desktop/desktopApi';
import {
  DESKTOP_DISPLAY_SNAPSHOT_URL,
  parseElectronDisplayPayload,
} from './displaySnapshotPayload';
import {
  buildDisplaySnapshot,
  type DisplaySnapshot,
  type DisplayTopologyMode,
  type MonitorReading,
} from './smartMirrorDisplay';

interface TopologyPayload {
  mode?: string;
  monitors?: MonitorReading[];
  primary?: MonitorReading | null;
}

const TOPOLOGY_MODES = new Set<DisplayTopologyMode>(['extend', 'clone', 'single', 'unknown']);

export async function loadDisplaySnapshot(): Promise<DisplaySnapshot> {
  if (!isDesktopApp()) {
    return buildDisplaySnapshot({
      runtimeAvailable: false,
      topology: 'unknown',
      monitors: [],
      primary: null,
    });
  }

  const bridge = getDesktopBridge();
  if (!bridge) {
    return buildDisplaySnapshot({
      runtimeAvailable: false,
      topology: 'unknown',
      monitors: [],
      primary: null,
    });
  }

  const payload = await bridge.getDisplaySnapshot() as TopologyPayload & DisplaySnapshot;

  if (payload.displays) {
    return payload;
  }

  const topology = TOPOLOGY_MODES.has(payload.topology as DisplayTopologyMode)
    ? payload.topology as DisplayTopologyMode
    : 'unknown';

  return buildDisplaySnapshot({
    runtimeAvailable: true,
    topology,
    monitors: payload.monitors ?? [],
    primary: payload.primary ?? null,
  });
}

export interface HardwareDisplayLoadOptions {
  bridge?: DesktopBridge | null;
  fetchSnapshot?: typeof fetch;
}

/**
 * Display snapshot for the hardware screen.
 * Inside the desktop window this uses the existing display IPC channel.
 * A browser tab on the dev server reads the same snapshot from the desktop
 * app's localhost endpoint. Neither path fills in a display size.
 */
export async function loadHardwareDisplaySnapshot(
  options: HardwareDisplayLoadOptions = {},
): Promise<DisplaySnapshot> {
  const bridge = options.bridge === undefined ? getDesktopBridge() : options.bridge;
  if (bridge) {
    let payload: unknown;
    try {
      payload = await bridge.getDisplaySnapshot();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The desktop app could not read the connected displays.';
      throw new Error(message);
    }
    return acceptedSnapshot(payload);
  }

  if (isDesktopApp()) {
    throw new Error('The desktop app could not read the connected displays.');
  }

  const fetchSnapshot = options.fetchSnapshot ?? fetch;
  let response: Response;
  try {
    response = await fetchSnapshot(DESKTOP_DISPLAY_SNAPSHOT_URL, { cache: 'no-store' });
  } catch {
    throw new Error('The desktop app is not running, so the TV display could not be read.');
  }
  if (!response.ok) {
    throw new Error('The desktop app could not read the connected displays.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The display snapshot from the desktop app was not valid.');
  }
  return acceptedSnapshot(payload);
}

function acceptedSnapshot(payload: unknown): DisplaySnapshot {
  const parsed = parseElectronDisplayPayload(payload);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.snapshot;
}
