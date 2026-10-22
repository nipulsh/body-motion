import type { Request, Response } from 'express';
import { z } from 'zod';
import { exerciseSchema } from '../schemas/exercise.schema';
import { getOrCreateExerciseDemoVideo } from '../services/gemini/exercise-demo-video.service';
import type { ExerciseDemoVideoResponse } from '../types/api';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

const demoVideoRequestSchema = z.object({
  exercise: exerciseSchema,
});

export const generateExerciseDemoVideoHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw AppError.unauthorized();

  const { exercise } = demoVideoRequestSchema.parse(req.body ?? {});
  const result = await getOrCreateExerciseDemoVideo(exercise);

  const body: ExerciseDemoVideoResponse = {
    exerciseId: result.exerciseId,
    demoVideoUrl: result.demoVideoUrl,
    cached: result.cached,
  };
  res.json(body);
});
