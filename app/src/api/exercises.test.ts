import { describe, expect, it, vi, beforeEach } from 'vitest';
import { enrichExerciseWithDemoVideo, mapExerciseFromApi, generateExercises } from './exercises';

vi.mock('./client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from './client';

const sampleExercise = {
  id: 'elbow_flex',
  name: 'Elbow flexion',
  description: 'Flex the elbow slowly.',
  targetBodyParts: ['elbow'],
  difficulty: 'beginner' as const,
  sets: 3,
  recommendedReps: 10,
  restSeconds: 30,
  instructions: ['Keep your shoulder relaxed'],
  safetyNotes: ['Stop if you feel pain'],
  trackingRules: [
    {
      joint: 'left_elbow',
      startAngle: 170,
      requiredAngle: 90,
      minimumAngle: 45,
      maximumAngle: 180,
      tolerance: 10,
      movement: 'flexion',
      startingPosition: 'Arm extended',
      targetPosition: 'Elbow bent',
    },
  ],
};

describe('generateExercises', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('loads and maps exercises from the API', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      jobId: 'job-1',
      modelName: 'gemini-test',
      exercises: [sampleExercise],
    });

    const result = await generateExercises('job-1');
    expect(apiFetch).toHaveBeenCalledWith('/api/jobs/job-1/exercises', { method: 'POST' });
    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0]?.id).toBe('elbow_flex');
  });

  it('throws when the API returns an empty exercise list', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      jobId: 'job-1',
      modelName: 'gemini-test',
      exercises: [],
    });

    await expect(generateExercises('job-1')).rejects.toThrow(/No exercises/);
  });

  it('maps tracking rule movements safely', () => {
    const mapped = mapExerciseFromApi({
      ...sampleExercise,
      trackingRules: [{ ...sampleExercise.trackingRules[0]!, movement: 'unknown_move' }],
    });
    expect(mapped.trackingRules[0]?.movement).toBe('flexion');
  });

  it('preserves API demoVideoUrl when provided', () => {
    const mapped = mapExerciseFromApi({
      ...sampleExercise,
      demoVideoUrl: '/exercise-videos/elbow-flex.webm',
    });
    expect(mapped.demoVideoUrl).toBe('/exercise-videos/elbow-flex.webm');
  });

  it('leaves demoVideoUrl null when no video is configured', () => {
    const mapped = enrichExerciseWithDemoVideo(mapExerciseFromApi(sampleExercise));
    expect(mapped.demoVideoUrl).toBeNull();
  });
});
