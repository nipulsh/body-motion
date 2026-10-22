export type DisplayOrientation = 'portrait' | 'landscape' | 'square';

/** OS arrangement of the active outputs. `unknown` means the runtime could not tell. */
export type DisplayTopologyMode = 'extend' | 'clone' | 'single' | 'unknown';

export interface MonitorReading {
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  /** Electron clockwise rotation: 0, 90, 180, or 270. Omitted when the runtime did not report it. */
  rotation?: number | null;
}

export interface ConnectedDisplay {
  id: string;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
  orientation: DisplayOrientation;
  /** Clockwise degrees from Electron, or null when the runtime did not report a 0/90/180/270 value. */
  rotation: number | null;
}

export interface DisplaySnapshot {
  /** False when monitor enumeration is unavailable, such as in a plain browser. */
  runtimeAvailable: boolean;
  topology: DisplayTopologyMode;
  displays: ConnectedDisplay[];
}

export type MirrorSelectionStatus = 'unavailable' | 'none' | 'duplicate' | 'selected' | 'choose';

export interface MirrorDisplaySelection {
  status: MirrorSelectionStatus;
  /** The one external display to use. Null when the user still has to choose. */
  candidate: ConnectedDisplay | null;
  /** External displays that remain eligible. More than one requires an explicit choice. */
  candidates: ConnectedDisplay[];
  message: string;
}

/** Keep only the four rotations Electron documents. Anything else is unknown. */
export function normalizeDisplayRotation(value: number | null | undefined): number | null {
  if (value === 0 || value === 90 || value === 180 || value === 270) return value;
  return null;
}

export function displayOrientation(width: number, height: number): DisplayOrientation {
  if (height > width) return 'portrait';
  if (width > height) return 'landscape';
  return 'square';
}

export function buildDisplaySnapshot(input: {
  runtimeAvailable: boolean;
  topology: DisplayTopologyMode;
  monitors: MonitorReading[];
  primary: MonitorReading | null;
}): DisplaySnapshot {
  const primaryIndex = findPrimaryIndex(input.monitors, input.primary);
  const used = new Map<string, number>();
  const displays = input.monitors.map((monitor, index) => {
    const base = `${monitor.name?.trim() || 'display'}:${monitor.x},${monitor.y}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return {
      id: seen === 0 ? base : `${base}#${seen + 1}`,
      name: monitor.name,
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height,
      scaleFactor: monitor.scaleFactor,
      primary: index === primaryIndex,
      orientation: displayOrientation(monitor.width, monitor.height),
      rotation: normalizeDisplayRotation(monitor.rotation),
    };
  });
  return {
    runtimeAvailable: input.runtimeAvailable,
    topology: input.topology,
    displays,
  };
}

export function selectSmartMirrorDisplay(snapshot: DisplaySnapshot): MirrorDisplaySelection {
  if (!snapshot.runtimeAvailable) {
    return {
      status: 'unavailable',
      candidate: null,
      candidates: [],
      message: 'Display enumeration runs inside the Body Motion desktop window.',
    };
  }

  const primary = snapshot.displays.find((display) => display.primary) ?? null;
  const externals = sortDisplays(
    snapshot.displays.filter((display) => isIndependentExternal(display, primary)),
  );
  const duplicated = isDuplicatedDesktop(snapshot, externals);

  if (duplicated) {
    return {
      status: 'duplicate',
      candidate: null,
      candidates: [],
      message:
        'Windows is duplicating this desktop onto another display. Switch to Extend so the Smart Mirror can use that display on its own.',
    };
  }

  if (!primary && snapshot.displays.length > 1) {
    return {
      status: 'choose',
      candidate: null,
      candidates: sortDisplays(snapshot.displays),
      message: 'The primary display could not be identified. Choose the Smart Mirror display explicitly.',
    };
  }

  if (externals.length === 0) {
    return {
      status: 'none',
      candidate: null,
      candidates: [],
      message:
        'No external display detected. Connect the TV and set Windows to Extend displays.',
    };
  }

  const portraits = externals.filter((display) => display.orientation === 'portrait');
  if (externals.length === 1 || portraits.length === 1) {
    const candidate = portraits.length === 1 ? portraits[0] : externals[0];
    return {
      status: 'selected',
      candidate,
      candidates: [candidate],
      message: 'One external display is available for the Smart Mirror.',
    };
  }

  const candidates = portraits.length > 1 ? portraits : externals;
  return {
    status: 'choose',
    candidate: null,
    candidates,
    message: 'Several external displays are connected. Choose the Smart Mirror display explicitly.',
  };
}

export function displaySnapshotsEqual(current: DisplaySnapshot | null, next: DisplaySnapshot): boolean {
  if (!current) return false;
  if (current.runtimeAvailable !== next.runtimeAvailable || current.topology !== next.topology) return false;
  if (current.displays.length !== next.displays.length) return false;
  return current.displays.every((display, index) => {
    const other = next.displays[index];
    return display.id === other.id
      && display.name === other.name
      && display.x === other.x
      && display.y === other.y
      && display.width === other.width
      && display.height === other.height
      && display.primary === other.primary
      && display.orientation === other.orientation
      && (display.rotation ?? null) === (other.rotation ?? null)
      && Math.abs(display.scaleFactor - other.scaleFactor) < 0.001;
  });
}

function findPrimaryIndex(monitors: MonitorReading[], primary: MonitorReading | null): number {
  if (monitors.length === 0) return -1;
  if (monitors.length === 1) return 0;
  if (primary) {
    const match = monitors.findIndex((monitor) => sameRect(monitor, primary));
    if (match >= 0) return match;
  }
  const origin = monitors.findIndex((monitor) => monitor.x === 0 && monitor.y === 0);
  return origin;
}

function isIndependentExternal(display: ConnectedDisplay, primary: ConnectedDisplay | null): boolean {
  if (display.primary) return false;
  if (!primary) return true;
  return !sameRect(display, primary);
}

function isDuplicatedDesktop(snapshot: DisplaySnapshot, externals: ConnectedDisplay[]): boolean {
  if (externals.length > 0) return false;
  if (snapshot.topology === 'clone') return true;
  const rects = new Set(snapshot.displays.map(rectKey));
  return snapshot.displays.length > 1 && rects.size === 1;
}

function sameRect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function rectKey(display: ConnectedDisplay): string {
  return `${display.x},${display.y},${display.width},${display.height}`;
}

function sortDisplays(displays: ConnectedDisplay[]): ConnectedDisplay[] {
  return [...displays].sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id));
}
