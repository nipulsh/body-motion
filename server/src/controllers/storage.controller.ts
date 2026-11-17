import type { Request, Response } from 'express';
import { env } from '../config/env';
import {
  mimeFromStoragePath,
  resolveLocalObjectPath,
  verifyLocalSignedUrl,
} from '../services/storage/local.storage';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

function readObjectPath(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((part): part is string => typeof part === 'string').join('/');
  }
  if (typeof value !== 'string') return '';
  return value.replace(/^\/+/, '');
}

export const serveLocalObjectHandler = asyncHandler(async (req: Request, res: Response) => {
  if (env.STORAGE_DRIVER !== 'local') {
    throw AppError.notFound();
  }

  const bucket = typeof req.params.bucket === 'string' ? req.params.bucket : '';
  const storagePath = readObjectPath(req.params.objectPath);
  if (!bucket || !storagePath) {
    throw AppError.badRequest('Invalid storage path.');
  }

  verifyLocalSignedUrl({
    secret: env.localStorageSigningSecret,
    bucket,
    storagePath,
    expires: req.query.expires,
    token: req.query.token,
  });

  const absolutePath = resolveLocalObjectPath(env.localStorageDir, bucket, storagePath);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'private, max-age=60');

  await new Promise<void>((resolve, reject) => {
    res.sendFile(
      absolutePath,
      {
        headers: {
          'Content-Type': mimeFromStoragePath(storagePath),
        },
      },
      (error) => {
        if (!error) {
          resolve();
          return;
        }
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          reject(AppError.notFound('Storage object not found.'));
          return;
        }
        reject(error);
      },
    );
  });
});
