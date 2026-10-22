import {
  buildDisplaySnapshot,
  type DisplaySnapshot,
  type DisplayTopologyMode,
  type MonitorReading,
} from './smartMirrorDisplay';

export const DESKTOP_DISPLAY_SNAPSHOT_URL = 'http://127.0.0.1:47321/display-snapshot';

const TOPOLOGY_MODES = new Set<DisplayTopologyMode>(['extend', 'clone', 'single', 'unknown']);

export type DisplayPayloadResult =
  | { ok: true; snapshot: DisplaySnapshot }
  | { ok: false; message: string };

/**
 * Accept the monitor payload produced by Electron's display snapshot.
 * Sizes must be the reported numbers. Missing or non-positive sizes are rejected.
 */
export function parseElectronDisplayPayload(input: unknown): DisplayPayloadResult {
  if (!isRecord(input)) {
    return { ok: false, message: 'The display snapshot from the desktop app was not valid.' };
  }
  if (input.runtimeAvailable !== true) {
    return { ok: false, message: 'The desktop app could not read the connected displays.' };
  }
  if (!isTopology(input.topology)) {
    return { ok: false, message: 'The display snapshot from the desktop app was not valid.' };
  }
  if (!Array.isArray(input.monitors)) {
    return { ok: false, message: 'The display snapshot from the desktop app was not valid.' };
  }

  const monitors: MonitorReading[] = [];
  for (const monitor of input.monitors) {
    const parsed = parseMonitor(monitor);
    if (!parsed.ok) return parsed;
    monitors.push(parsed.monitor);
  }

  let primary: MonitorReading | null = null;
  if (input.primary != null) {
    const parsedPrimary = parseMonitor(input.primary);
    if (!parsedPrimary.ok) return parsedPrimary;
    primary = parsedPrimary.monitor;
  }

  return {
    ok: true,
    snapshot: buildDisplaySnapshot({
      runtimeAvailable: true,
      topology: input.topology,
      monitors,
      primary,
    }),
  };
}

function parseMonitor(input: unknown): { ok: true; monitor: MonitorReading } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: 'The display snapshot from the desktop app was not valid.' };
  }
  const name = parseName(input.name);
  if (!name.ok) return name;
  const x = finiteNumber(input.x, 'Display position');
  const y = finiteNumber(input.y, 'Display position');
  const width = positiveNumber(input.width, 'Display width');
  const height = positiveNumber(input.height, 'Display height');
  const scaleFactor = positiveNumber(input.scaleFactor, 'Display scale factor');
  const numbers = [x, y, width, height, scaleFactor];
  for (const number of numbers) {
    if (!number.ok) return number;
  }
  if (!x.ok || !y.ok || !width.ok || !height.ok || !scaleFactor.ok) {
    return { ok: false, message: 'The display snapshot from the desktop app was not valid.' };
  }
  const rotation = parseRotation(input.rotation);
  if (!rotation.ok) return rotation;
  return {
    ok: true,
    monitor: {
      name: name.value,
      x: x.value,
      y: y.value,
      width: width.value,
      height: height.value,
      scaleFactor: scaleFactor.value,
      rotation: rotation.value,
    },
  };
}

function parseName(input: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== 'string' || input.length > 200) {
    return { ok: false, message: 'The display snapshot from the desktop app was not valid.' };
  }
  const trimmed = input.trim();
  return { ok: true, value: trimmed === '' ? null : trimmed };
}

function parseRotation(input: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  if (input === 0 || input === 90 || input === 180 || input === 270) return { ok: true, value: input };
  return { ok: false, message: 'Display rotation must be 0, 90, 180, 270, or empty.' };
}

function finiteNumber(
  input: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return { ok: false, message: `${label} must be a finite number.` };
  }
  return { ok: true, value: input };
}

function positiveNumber(
  input: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const parsed = finiteNumber(input, label);
  if (!parsed.ok) return parsed;
  if (!(parsed.value > 0)) return { ok: false, message: `${label} must be a positive number.` };
  return parsed;
}

function isTopology(value: unknown): value is DisplayTopologyMode {
  return typeof value === 'string' && TOPOLOGY_MODES.has(value as DisplayTopologyMode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
