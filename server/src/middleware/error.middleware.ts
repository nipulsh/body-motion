import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env';
import type { ApiErrorBody } from '../types/api';
import { AppError } from '../utils/AppError';
import { formatZodIssue, formatZodIssues } from '../utils/formatZodIssues';
import { logger } from '../utils/logger';
import { mapPrismaError, prismaErrorLogFields } from '../utils/prismaError';

function formatZodError(error: ZodError): ApiErrorBody {
  const details = formatZodIssues(error);
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details,
    },
  };
}

function formatAppErrorDetails(details: unknown): unknown {
  if (!details || typeof details !== 'object') return details;
  const record = details as Record<string, unknown>;
  if (!Array.isArray(record.issues)) return details;
  return {
    issues: record.issues.map((issue) =>
      issue && typeof issue === 'object' && 'path' in issue && 'code' in issue && 'message' in issue
        ? formatZodIssue(issue as ZodError['issues'][number])
        : issue,
    ),
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
  };
  res.status(404).json(body);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    const body = formatZodError(err);
    logger.error('[ERROR]', {
      stage: 'VALIDATION',
      status: 400,
      errorName: 'ZodError',
      message: 'Request validation failed.',
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      ...(!env.isProduction ? { details: body.error.details } : {}),
    });
    res.status(400).json(body);
    return;
  }

  if (err instanceof multer.MulterError) {
    logger.error('[ERROR]', {
      stage: 'UPLOAD',
      status: 400,
      errorName: err.name,
      message: err.message,
      requestId: req.requestId,
    });
    const body: ApiErrorBody = {
      error: {
        code: err.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'UPLOAD_ERROR',
        message: err.message,
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof AppError) {
    const formattedDetails = formatAppErrorDetails(err.details);
    logger.error('[ERROR]', {
      stage: 'APP_ERROR',
      status: err.statusCode,
      errorName: err.name,
      code: err.code,
      message: err.message,
      requestId: req.requestId,
      ...(env.isProduction || (err.expose && err.statusCode < 500)
        ? {}
        : { stack: err.stack, ...(formattedDetails ? { details: formattedDetails } : {}) }),
    });

    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.expose ? err.message : 'An unexpected error occurred.',
        ...(err.expose && formattedDetails !== undefined ? { details: formattedDetails } : {}),
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  const prismaMapped = mapPrismaError(err);
  if (prismaMapped) {
    logger.error('[ERROR]', {
      stage: 'DATABASE',
      status: prismaMapped.statusCode,
      requestId: req.requestId,
      ...prismaErrorLogFields(err),
    });
    res.status(prismaMapped.statusCode).json({
      error: {
        code: prismaMapped.code,
        message: prismaMapped.message,
      },
    });
    return;
  }

  logger.error('[ERROR]', {
    stage: 'UNHANDLED',
    status: 500,
    requestId: req.requestId,
    errorName: err instanceof Error ? err.name : undefined,
    message: err instanceof Error ? err.message : String(err),
    ...(env.isProduction ? {} : { stack: err instanceof Error ? err.stack : undefined }),
  });

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  };
  res.status(500).json(body);
}
