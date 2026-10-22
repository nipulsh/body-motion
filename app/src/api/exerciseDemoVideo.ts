import type { Exercise } from '@vision';
import { apiFetch } from './client';
import type { ExerciseDemoVideoResponse } from './types';

export async function requestExerciseDemoVideo(exercise: Exercise): Promise<ExerciseDemoVideoResponse> {
  return apiFetch<ExerciseDemoVideoResponse>('/api/exercises/demo-video', {
    method: 'POST',
    body: JSON.stringify({ exercise }),
  });
}
