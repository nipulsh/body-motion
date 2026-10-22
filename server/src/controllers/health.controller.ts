import type { Request, Response } from 'express';
import { env } from '../config/env';
import { pingDatabase } from '../repositories/prisma';
import type { HealthResponse } from '../types/api';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const getHealth = asyncHandler(async (_req: Request, res: Response) => {
  const databaseOk = await pingDatabase();
  const body: HealthResponse = {
    status: databaseOk ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    database: databaseOk ? 'ok' : 'error',
    models: {
      analysis: env.GEMINI_ANALYSIS_MODEL,
      imageGeneration: env.GEMINI_IMAGE_MODEL,
    },
  };
  res.status(200).json(body);
});

export const testUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file?.buffer?.length) {
    throw AppError.badRequest('A single image file is required in the "image" field.');
  }

  res.json({
    ok: true,
    fileName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.buffer.length,
  });
});
