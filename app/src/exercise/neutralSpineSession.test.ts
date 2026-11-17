import { beforeEach, describe, expect, it } from 'vitest';
import { getNeutralSpineProfile, resetNeutralSpineProfile, setNeutralSpineProfile, type NeutralSpineProfile } from '@vision';
import { installNeutralSpineSessionStore } from './neutralSpineSession';

const KEY = 'bpsy:neutral-spine:v1';
const SPINEPOSE_KEY = 'bpsy:neutral-spine:spinepose:v1';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
  };
}

function profile(capturedAt: number): NeutralSpineProfile {
  return {
    version: 1,
    capturedAt,
    thoracicSagitta: 0.01,
    lumbarSagitta: 0.02,
    trunkLeanDeg: 4,
    hipAngleDeg: 160,
    hipShoulderScale: 0.4,
    sampleCount: 8,
  };
}

describe('neutral spine session store', () => {
  beforeEach(() => {
    resetNeutralSpineProfile();
  });

  it('restores a fresh baseline and writes the next one', () => {
    const storage = memoryStorage(JSON.stringify(profile(500)));
    installNeutralSpineSessionStore(storage, 1_000);
    expect(getNeutralSpineProfile()?.lumbarSagitta).toBe(0.02);
    setNeutralSpineProfile(profile(1_000));
    expect(JSON.parse(storage.getItem(KEY)!).thoracicSagitta).toBe(0.01);
  });

  it('drops a stale or unreadable baseline', () => {
    const stale = memoryStorage(JSON.stringify(profile(0)));
    installNeutralSpineSessionStore(stale, 20 * 60 * 60 * 1000);
    expect(getNeutralSpineProfile()).toBeNull();
    expect(stale.getItem(KEY)).toBeNull();

    const broken = memoryStorage('{');
    installNeutralSpineSessionStore(broken, 1_000);
    expect(broken.getItem(KEY)).toBeNull();
  });

  it('stores a SpinePose baseline apart from the outline one, and restores each to its own slot', () => {
    const storage = memoryStorage();
    installNeutralSpineSessionStore(storage, 1_000);
    const keypoints: NeutralSpineProfile = { ...profile(1_000), source: 'spinepose', thoracicSagitta: 0.05 };
    setNeutralSpineProfile(keypoints);
    setNeutralSpineProfile(profile(1_000));
    expect(JSON.parse(storage.getItem(SPINEPOSE_KEY)!).thoracicSagitta).toBe(0.05);
    expect(JSON.parse(storage.getItem(KEY)!).thoracicSagitta).toBe(0.01);

    // A page reload: memory is gone, session storage is not.
    const saved = new Map(storage.values);
    resetNeutralSpineProfile();
    for (const [key, value] of saved) storage.setItem(key, value);
    installNeutralSpineSessionStore(storage, 1_000);
    expect(getNeutralSpineProfile('spinepose')?.thoracicSagitta).toBe(0.05);
    expect(getNeutralSpineProfile()?.thoracicSagitta).toBe(0.01);
  });

  it('will not load a baseline from the wrong slot, so the two scales can never mix', () => {
    const storage = memoryStorage(JSON.stringify({ ...profile(500), source: 'spinepose' }));
    installNeutralSpineSessionStore(storage, 1_000);
    expect(getNeutralSpineProfile()).toBeNull();
    expect(getNeutralSpineProfile('spinepose')).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });
});
