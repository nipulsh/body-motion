/** Saved Mirror Rehab settings and last choices (browser storage, this device only). */

export type PoseSourceKind = 'camera' | 'mock' | 'websocket';

export interface Alignment {
  /** Offsets as a fraction of the screen height. */
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface RehabSettings {
  alignment: Alignment;
  muted: boolean;
  audioOffsetMs: number;
  cameraLatencyMs: number;
  legFactor: { left: number; right: number };
  assist: boolean;
  poseSource: PoseSourceKind;
  debugSkeleton: boolean;
  lastGame: string;
  /** Last level index per game (and per view for the squat game). */
  lastLevel: Record<string, number>;
  options: Record<string, Record<string, string | boolean>>;
  firstRunSeen: boolean;
}

export const SETTINGS_KEY = 'bpsy.rehab.settings';

export const DEFAULT_SETTINGS: RehabSettings = {
  alignment: { offsetX: 0, offsetY: 0, scale: 1 },
  muted: false,
  audioOffsetMs: 0,
  cameraLatencyMs: 100,
  legFactor: { left: 1, right: 1 },
  assist: false,
  poseSource: 'camera',
  debugSkeleton: false,
  lastGame: 'squat',
  lastLevel: {},
  options: {},
  firstRunSeen: false,
};

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Merge stored JSON onto the defaults, ignoring anything malformed. */
export function parseSettings(raw: string | null): RehabSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw) return structuredClone(d);
  let p: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return structuredClone(d);
    p = parsed as Record<string, unknown>;
  } catch {
    return structuredClone(d);
  }
  const a = (p.alignment ?? {}) as Record<string, unknown>;
  const lf = (p.legFactor ?? {}) as Record<string, unknown>;
  const lastLevel: Record<string, number> = {};
  if (p.lastLevel && typeof p.lastLevel === 'object') {
    for (const [k, v] of Object.entries(p.lastLevel as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10) lastLevel[k] = v;
    }
  }
  const options: RehabSettings['options'] = {};
  if (p.options && typeof p.options === 'object') {
    for (const [game, o] of Object.entries(p.options as Record<string, unknown>)) {
      if (!o || typeof o !== 'object') continue;
      const clean: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'boolean') clean[k] = v;
      }
      options[game] = clean;
    }
  }
  return {
    alignment: {
      offsetX: num(a.offsetX, 0, -1, 1),
      offsetY: num(a.offsetY, 0, -1, 1),
      scale: num(a.scale, 1, 0.3, 3),
    },
    muted: typeof p.muted === 'boolean' ? p.muted : d.muted,
    audioOffsetMs: num(p.audioOffsetMs, d.audioOffsetMs, -500, 500),
    cameraLatencyMs: num(p.cameraLatencyMs, d.cameraLatencyMs, 0, 600),
    legFactor: { left: num(lf.left, 1, 0.5, 1.5), right: num(lf.right, 1, 0.5, 1.5) },
    assist: typeof p.assist === 'boolean' ? p.assist : d.assist,
    poseSource: p.poseSource === 'mock' || p.poseSource === 'websocket' ? p.poseSource : 'camera',
    debugSkeleton: typeof p.debugSkeleton === 'boolean' ? p.debugSkeleton : false,
    lastGame: typeof p.lastGame === 'string' ? p.lastGame : d.lastGame,
    lastLevel,
    options,
    firstRunSeen: p.firstRunSeen === true,
  };
}

export function loadSettings(): RehabSettings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: RehabSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked or full: settings last for this visit only.
  }
}

/** Pick the game the Games menu asked for before opening Mirror Rehab. */
export function setLastRehabGame(gameId: string): void {
  const s = loadSettings();
  s.lastGame = gameId;
  saveSettings(s);
}
