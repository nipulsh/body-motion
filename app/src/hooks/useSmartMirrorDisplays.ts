import { useEffect, useState } from 'react';
import { loadDisplaySnapshot } from '../display/loadDisplays';
import { displaySnapshotsEqual, type DisplaySnapshot } from '../display/smartMirrorDisplay';

const DISPLAY_REFRESH_MS = 5000;

export function useSmartMirrorDisplays(
  load: () => Promise<DisplaySnapshot> = loadDisplaySnapshot,
): {
  snapshot: DisplaySnapshot | null;
  error: string | null;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((next) => {
        if (cancelled) return;
        setSnapshot((current) => (displaySnapshotsEqual(current, next) ? current : next));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not read the connected displays.');
      });
    return () => {
      cancelled = true;
    };
  }, [load, refreshToken]);

  useEffect(() => subscribeToDisplayChanges(() => {
    setRefreshToken((current) => current + 1);
  }), []);

  return {
    snapshot,
    error,
    refresh: () => setRefreshToken((current) => current + 1),
  };
}

function subscribeToDisplayChanges(refresh: () => void): () => void {
  const onFocus = () => refresh();
  const onVisibility = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  const interval = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, DISPLAY_REFRESH_MS);

  return () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(interval);
  };
}
