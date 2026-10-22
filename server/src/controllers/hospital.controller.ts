import type { Request, Response } from 'express';
import {
  ensureHospitalForUser,
  serializeHospital,
} from '../repositories/hospital.repository';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { buildDefaultHospitalName } from '../utils/hospitalDefaults';
import { logger } from '../utils/logger';
import { prismaErrorLogFields } from '../utils/prismaError';

export const getMyHospitalHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) {
    throw AppError.unauthorized();
  }

  const defaultName = buildDefaultHospitalName();

  let hospital;
  try {
    hospital = await ensureHospitalForUser(auth.userId, {
      defaultName,
      defaultEmail: auth.email,
    });
  } catch (error) {
    logger.error('[ERROR]', {
      stage: 'ENSURE_HOSPITAL',
      status: 503,
      userId: auth.userId,
      ...prismaErrorLogFields(error),
    });
    throw error;
  }

  res.status(200).json({
    hospital: serializeHospital(hospital),
  });
});
