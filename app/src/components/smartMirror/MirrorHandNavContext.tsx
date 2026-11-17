import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface MirrorHandNavContextValue {
  analysisCaptureActive: boolean;
  setAnalysisCaptureActive: (active: boolean) => void;
  /** The exercise session's hand tracker is running and feeding the landmarks bus. */
  exerciseHandTrackingActive: boolean;
  setExerciseHandTrackingActive: (active: boolean) => void;
}

const MirrorHandNavContext = createContext<MirrorHandNavContextValue | null>(null);

export function MirrorHandNavProvider({ children }: { children: ReactNode }) {
  const [analysisCaptureActive, setAnalysisCaptureActiveState] = useState(false);
  const setAnalysisCaptureActive = useCallback((active: boolean) => {
    setAnalysisCaptureActiveState(active);
  }, []);
  const [exerciseHandTrackingActive, setExerciseHandTrackingActiveState] = useState(false);
  const setExerciseHandTrackingActive = useCallback((active: boolean) => {
    setExerciseHandTrackingActiveState(active);
  }, []);

  const value = useMemo(
    () => ({
      analysisCaptureActive,
      setAnalysisCaptureActive,
      exerciseHandTrackingActive,
      setExerciseHandTrackingActive,
    }),
    [analysisCaptureActive, setAnalysisCaptureActive, exerciseHandTrackingActive, setExerciseHandTrackingActive],
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

/** For screens that also render outside the mirror shell. */
export function useOptionalMirrorHandNav(): MirrorHandNavContextValue | null {
  return useContext(MirrorHandNavContext);
}
