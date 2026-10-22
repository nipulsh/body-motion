import {
  selectSmartMirrorDisplay,
  type ConnectedDisplay,
  type DisplaySnapshot,
} from './smartMirrorDisplay';

export const SMART_MIRROR_WINDOW_LABEL = 'smart-mirror';

export type MirrorPhase = 'closed' | 'open' | 'waiting-for-display';

export interface MirrorWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  physicalX: number;
  physicalY: number;
}

export type MirrorOpenPlan =
  | { ok: true; display: ConnectedDisplay; bounds: MirrorWindowBounds }
  | { ok: false; message: string; choices: ConnectedDisplay[] };

export function isSmartMirrorWindowLabel(label: string | null | undefined): boolean {
  return label === SMART_MIRROR_WINDOW_LABEL;
}

/** Logical window bounds from the display's physical pixels. Positions may be negative. */
export function mirrorWindowBounds(display: ConnectedDisplay): MirrorWindowBounds {
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1;
  return {
    x: display.x / scale,
    y: display.y / scale,
    width: display.width / scale,
    height: display.height / scale,
    physicalX: display.x + display.width / 2,
    physicalY: display.y + display.height / 2,
  };
}

export function mirrorBoundsChanged(current: MirrorWindowBounds, next: MirrorWindowBounds): boolean {
  return Math.abs(current.x - next.x) >= 1
    || Math.abs(current.y - next.y) >= 1
    || Math.abs(current.width - next.width) >= 1
    || Math.abs(current.height - next.height) >= 1
    || Math.abs(current.physicalX - next.physicalX) >= 1
    || Math.abs(current.physicalY - next.physicalY) >= 1;
}

export function planSmartMirrorOpen(snapshot: DisplaySnapshot, displayId?: string | null): MirrorOpenPlan {
  const selection = selectSmartMirrorDisplay(snapshot);
  if (selection.status === 'choose' && !displayId) {
    return { ok: false, message: selection.message, choices: selection.candidates };
  }
  if (!selection.candidate && selection.status !== 'choose') {
    return { ok: false, message: selection.message, choices: [] };
  }

  const display = displayId
    ? selection.candidates.find((candidate) => candidate.id === displayId) ?? null
    : selection.candidate;
  if (!display) {
    return {
      ok: false,
      message: 'Choose one of the connected external displays.',
      choices: selection.candidates,
    };
  }
  return { ok: true, display, bounds: mirrorWindowBounds(display) };
}

export function findReturnedDisplay(
  displays: ConnectedDisplay[],
  selected: { id: string; name: string | null },
): ConnectedDisplay | null {
  const byId = displays.find((display) => display.id === selected.id && !display.primary);
  if (byId) return byId;
  if (!selected.name) return null;
  const byName = displays.filter((display) => !display.primary && display.name === selected.name);
  return byName.length === 1 ? byName[0] : null;
}

export function nextMirrorPhase(input: {
  phase: MirrorPhase;
  displayPresent: boolean;
  windowOpen: boolean;
  openedRecently: boolean;
}): MirrorPhase {
  if (input.phase === 'closed') return 'closed';
  if (!input.displayPresent) return 'waiting-for-display';
  if (input.phase === 'waiting-for-display') return 'open';
  if (!input.windowOpen && !input.openedRecently) return 'closed';
  return 'open';
}

export function canStartMirrorOpen(inFlight: boolean): boolean {
  return !inFlight;
}
