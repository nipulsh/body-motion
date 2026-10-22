import { useAppAuth } from '../auth/AppAuthContext';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, isAuthenticationError, isOfflineError, NetworkError } from '../api/client';
import { getMyHospital } from '../api/hospital';
import type { HospitalSummary } from '../api/types';
import { useConnectivity } from '../connectivity/ConnectivityContext';
import { loadHospital, saveHospital } from '../offline/localCache';

interface HospitalContextValue {
  hospital: HospitalSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const HospitalContext = createContext<HospitalContextValue | null>(null);

function toUserMessage(error: unknown, isOnline: boolean): string {
  if (isOfflineError(error) || (!isOnline && error instanceof NetworkError)) {
    return 'Hospital information is not available offline.';
  }
  if (error instanceof NetworkError) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (isAuthenticationError(error)) {
    return 'The server rejected this request.';
  }
  if (error instanceof ApiError) {
    if (error.message) {
      return error.message;
    }
  }
  return 'Could not load hospital information. Please try again.';
}

export function HospitalProvider({ children }: { children: ReactNode }) {
  const { userId } = useAppAuth();
  const { isOnline } = useConnectivity();
  const [hospital, setHospital] = useState<HospitalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) {
      setHospital(null);
      setLoading(false);
      return;
    }

    if (!isOnline) {
      const cached = loadHospital(userId);
      setHospital(cached);
      setError(cached ? null : 'Hospital information is not available offline.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await getMyHospital();
      setHospital(response.hospital);
      saveHospital(userId, response.hospital);
    } catch (err) {
      console.error('[hospital] Failed to load hospital profile:', err instanceof Error ? err.message : err);
      const cached = loadHospital(userId);
      if (cached) {
        setHospital(cached);
        setError(null);
      } else {
        setHospital(null);
        setError(toUserMessage(err, isOnline));
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({
      hospital,
      loading,
      error,
      reload,
    }),
    [hospital, loading, error, reload],
  );

  return <HospitalContext.Provider value={value}>{children}</HospitalContext.Provider>;
}

export function useHospital(): HospitalContextValue {
  const ctx = useContext(HospitalContext);
  if (!ctx) {
    throw new Error('useHospital must be used within HospitalProvider');
  }
  return ctx;
}
