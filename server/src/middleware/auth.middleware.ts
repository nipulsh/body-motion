import type { NextFunction, Request, Response } from 'express';
import { upsertUser } from '../repositories/user.repository';
import { asyncHandler } from '../utils/asyncHandler';
import {
  isJobUploadRequest,
  isPatientsCollectionRequest,
  jobUploadError,
  jobUploadLog,
  patientsLog,
} from '../utils/jobUploadLog';
import { logger } from '../utils/logger';
import { prismaErrorLogFields } from '../utils/prismaError';

const LOCAL_USER_ID = 'local-dev-user';
const LOCAL_USER_EMAIL = 'dev@local';

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const jobUpload = isJobUploadRequest(req.method, req.originalUrl);
  const patientsCollection = isPatientsCollectionRequest(req.method, req.originalUrl);

  try {
    await upsertUser(LOCAL_USER_ID, LOCAL_USER_EMAIL);
  } catch (error) {
    logger.error('[ERROR]', {
      stage: 'AUTH_UPSERT_USER',
      status: 503,
      ...prismaErrorLogFields(error),
    });
    if (jobUpload) {
      jobUploadError('DATABASE', { status: 503, ...prismaErrorLogFields(error) });
    }
    throw error;
  }

  req.auth = {
    userId: LOCAL_USER_ID,
    email: LOCAL_USER_EMAIL,
  };

  if (patientsCollection) {
    patientsLog('authenticated', { authenticated: true, requestId: req.requestId });
  }
  if (jobUpload) {
    jobUploadLog('authenticated', { authenticated: true, requestId: req.requestId });
  }

  next();
});
