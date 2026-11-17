import {
  assessNeutralSpineProfile,
  setNeutralSpineProfile,
  subscribeNeutralSpineProfile,
  VISION_CONFIG,
  type NeutralSpineProfile,
  type SpineSignalSource,
} from '@vision';

/**
 * One slot per source: the outline and the spine keypoints read on different scales. The version
 * moves whenever a reading's definition does, because a baseline from the old one would skew every
 * comparison until the browser session ended.
 */
const STORAGE_KEYS: Record<SpineSignalSource, string> = {
  outline: 'bpsy:neutral-spine:v2',
  spinepose: 'bpsy:neutral-spine:spinepose:v3',
};

interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let detach: (() => void) | null = null;

/**
 * Keep the standing side-view baseline for the rest of this browser session.
 * A missing, unreadable, or expired profile is ignored.
 */
export function installNeutralSpineSessionStore(storage?: ProfileStorage, now = Date.now()): void {
  const target = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  if (!target) return;
  detach?.();
  detach = null;
  const maxAge = VISION_CONFIG.deadliftForm.calibration.maxAgeMs;
  for (const source of ['outline', 'spinepose'] as const) {
    const key = STORAGE_KEYS[source];
    const loaded = readStored(target, key);
    // A profile found in the wrong slot comes back invalid here, so the two scales cannot mix.
    const assessed = assessNeutralSpineProfile(loaded.value, now, maxAge, source);
    if (assessed.profile) setNeutralSpineProfile(assessed.profile);
    else if (loaded.present) target.removeItem(key);
  }
  detach = subscribeNeutralSpineProfile((profile, source) => writeStored(target, STORAGE_KEYS[source], profile));
}

function readStored(storage: ProfileStorage, key: string): { present: boolean; value: unknown } {
  try {
    const text = storage.getItem(key);
    if (!text) return { present: false, value: null };
    return { present: true, value: JSON.parse(text) as unknown };
  } catch {
    return { present: true, value: undefined };
  }
}

function writeStored(storage: ProfileStorage, key: string, profile: NeutralSpineProfile | null): void {
  try {
    if (profile) storage.setItem(key, JSON.stringify(profile));
    else storage.removeItem(key);
  } catch {
    // A full or blocked store leaves the in-memory baseline in place for this page.
  }
}
