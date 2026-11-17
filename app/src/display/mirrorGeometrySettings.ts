import { DEFAULT_MIRROR_GEOMETRY, type MirrorGeometry } from '@vision/pose/mirrorReflection';

/**
 * On-site overrides for the mirror geometry, as a partial JSON object, e.g.
 * `localStorage.setItem('bpsy.mirrorGeometry', '{"cameraTiltDownDeg":12}')`.
 * Both windows share the app origin, so setting it in the main window updates
 * the open TV window straight away (see `subscribeMirrorGeometry`).
 */
export const MIRROR_GEOMETRY_STORAGE_KEY = 'bpsy.mirrorGeometry';

type NumericKey = {
  [K in keyof MirrorGeometry]: MirrorGeometry[K] extends number ? K : never;
}[keyof MirrorGeometry];

const KEYS = (Object.keys(DEFAULT_MIRROR_GEOMETRY) as Array<keyof MirrorGeometry>).filter(
  (key): key is NumericKey => typeof DEFAULT_MIRROR_GEOMETRY[key] === 'number',
);

/** Merge valid numeric (and `showVideo` boolean) overrides onto the defaults. Unknown keys and bad values are ignored. */
export function parseMirrorGeometry(raw: string | null | undefined): MirrorGeometry {
  const geometry: MirrorGeometry = { ...DEFAULT_MIRROR_GEOMETRY };
  if (!raw) return geometry;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return geometry;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return geometry;
  for (const key of KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) geometry[key] = value;
  }
  const showVideo = (parsed as Record<string, unknown>).showVideo;
  if (typeof showVideo === 'boolean') geometry.showVideo = showVideo;
  if (geometry.screenWidthIn <= 0) geometry.screenWidthIn = DEFAULT_MIRROR_GEOMETRY.screenWidthIn;
  if (geometry.screenHeightIn <= 0) geometry.screenHeightIn = DEFAULT_MIRROR_GEOMETRY.screenHeightIn;
  if (geometry.userDistanceIn <= 0) geometry.userDistanceIn = DEFAULT_MIRROR_GEOMETRY.userDistanceIn;
  if (geometry.eyeFollowGain < 0) geometry.eyeFollowGain = DEFAULT_MIRROR_GEOMETRY.eyeFollowGain;
  if (geometry.videoFollowGainX < 0) geometry.videoFollowGainX = DEFAULT_MIRROR_GEOMETRY.videoFollowGainX;
  if (geometry.videoFollowGainY < 0) geometry.videoFollowGainY = DEFAULT_MIRROR_GEOMETRY.videoFollowGainY;
  if (geometry.videoZoom <= 0) geometry.videoZoom = DEFAULT_MIRROR_GEOMETRY.videoZoom;
  if (geometry.wireframeScale <= 0) geometry.wireframeScale = DEFAULT_MIRROR_GEOMETRY.wireframeScale;
  if (geometry.cameraDiagonalFovDeg <= 0 || geometry.cameraDiagonalFovDeg >= 180) {
    geometry.cameraDiagonalFovDeg = DEFAULT_MIRROR_GEOMETRY.cameraDiagonalFovDeg;
  }
  return geometry;
}

export function loadMirrorGeometry(): MirrorGeometry {
  try {
    return parseMirrorGeometry(window.localStorage.getItem(MIRROR_GEOMETRY_STORAGE_KEY));
  } catch {
    return parseMirrorGeometry(null);
  }
}

/**
 * Calls `listener` with the new geometry whenever the override changes in
 * another window of the app (the browser 'storage' event). Returns an unsubscribe.
 */
export function subscribeMirrorGeometry(listener: (geometry: MirrorGeometry) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MIRROR_GEOMETRY_STORAGE_KEY) return;
    listener(loadMirrorGeometry());
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
