import type { Exercise } from '@vision';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestExerciseDemoVideo } from '../api/exerciseDemoVideo';
import { resolveExerciseDemoVideoUrl } from '../exercise/demoVideos';

export type ExerciseDemoVideoLoadState = 'idle' | 'generating' | 'ready' | 'error';

export interface UseExerciseDemoVideoResult {
  demoVideoUrl: string | null;
  loadState: ExerciseDemoVideoLoadState;
  errorMessage: string | null;
  retry: () => void;
}

export function useExerciseDemoVideo(exercise: Exercise | null): UseExerciseDemoVideoResult {
  const [demoVideoUrl, setDemoVideoUrl] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<ExerciseDemoVideoLoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!exercise) {
      setDemoVideoUrl(null);
      setLoadState('idle');
      setErrorMessage(null);
      return;
    }

    const bundled = resolveExerciseDemoVideoUrl(exercise.id, exercise.demoVideoUrl);
    if (bundled) {
      setDemoVideoUrl(bundled);
      setLoadState('ready');
      setErrorMessage(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setDemoVideoUrl(null);
    setLoadState('generating');
    setErrorMessage(null);

    void requestExerciseDemoVideo(exercise)
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        setDemoVideoUrl(response.demoVideoUrl);
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return;
        const message =
          err instanceof Error ? err.message : 'Could not generate the demonstration video.';
        setErrorMessage(message);
        setLoadState('error');
      });
  }, [attempt, exercise?.id, exercise]);

  return { demoVideoUrl, loadState, errorMessage, retry };
}
