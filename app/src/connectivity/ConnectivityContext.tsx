import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  dispatchOnlineRefreshEvent,
  getIsOnline,
  subscribeToConnectivity,
} from './connectivity';

interface ConnectivityContextValue {
  isOnline: boolean;
  showReconnected: boolean;
}

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(getIsOnline);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    return subscribeToConnectivity((online) => {
      setIsOnline(online);
      if (online) {
        setShowReconnected(true);
        dispatchOnlineRefreshEvent();
        window.setTimeout(() => setShowReconnected(false), 3000);
      }
    });
  }, []);

  const value = useMemo(
    () => ({
      isOnline,
      showReconnected,
    }),
    [isOnline, showReconnected],
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): ConnectivityContextValue {
  const ctx = useContext(ConnectivityContext);
  if (!ctx) {
    throw new Error('useConnectivity must be used within ConnectivityProvider');
  }
  return ctx;
}
