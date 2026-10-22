import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface MirrorHandNavContextValue {
  analysisCaptureActive: boolean;
  setAnalysisCaptureActive: (active: boolean) => void;
}

const MirrorHandNavContext = createContext<MirrorHandNavContextValue | null>(null);

export function MirrorHandNavProvider({ children }: { children: ReactNode }) {
  const [analysisCaptureActive, setAnalysisCaptureActiveState] = useState(false);
  const setAnalysisCaptureActive = useCallback((active: boolean) => {
    setAnalysisCaptureActiveState(active);
  }, []);

  const value = useMemo(
    () => ({ analysisCaptureActive, setAnalysisCaptureActive }),
    [analysisCaptureActive, setAnalysisCaptureActive],
  );

  return <MirrorHandNavContext.Provider value={value}>{children}</MirrorHandNavContext.Provider>;
}

export function useMirrorHandNav(): MirrorHandNavContextValue {
  const ctx = useContext(MirrorHandNavContext);
  if (!ctx) {
    throw new Error('useMirrorHandNav must be used within MirrorHandNavProvider');
  }
  return ctx;
}
