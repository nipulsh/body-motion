import { generateExercises } from '../api/exercises';
import { loadExercisePlan, saveExercisePlan } from '../offline/localCache';
import type { Exercise } from '@vision';

const inFlight = new Map<string, Promise<Exercise[]>>();

/** The plan already saved for this job, if any. */
export function cachedSuggestedExercises(jobId: string): Exercise[] | null {
  return loadExercisePlan(jobId);
}

/**
 * The AI exercise plan for one analysis job. Each call to the server runs Gemini, so a saved plan
 * is reused and calls made while one is still running share it.
 */
export function loadSuggestedExercises(jobId: string): Promise<Exercise[]> {
  const cached = loadExercisePlan(jobId);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(jobId);
  if (pending) return pending;

  const request = generateExercises(jobId)
    .then(({ exercises }) => {
      saveExercisePlan(jobId, exercises);
      return exercises;
    })
    .finally(() => {
      inFlight.delete(jobId);
    });
  inFlight.set(jobId, request);
  return request;
}
