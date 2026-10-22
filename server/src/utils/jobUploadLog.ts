import { logger } from './logger';

export function jobUploadLog(message: string, context?: Record<string, unknown>): void {
  logger.info(`[JOB_UPLOAD] ${message}`, context);
}

export function jobUploadError(
  stage: string,
  context?: { status?: number; message?: string } & Record<string, unknown>,
): void {
  logger.error('[JOB_UPLOAD_ERROR]', { stage, ...context });
}

export function isJobUploadRequest(method: string, originalUrl: string): boolean {
  const path = originalUrl.split('?')[0] ?? '';
  return method === 'POST' && /\/patients\/[^/]+\/jobs\/?$/.test(path);
}

export function isPatientsCollectionRequest(method: string, originalUrl: string): boolean {
  const path = originalUrl.split('?')[0] ?? '';
  return /\/patients\/?$/.test(path) && (method === 'GET' || method === 'POST');
}

export function patientsLog(message: string, context?: Record<string, unknown>): void {
  logger.info(`[PATIENTS] ${message}`, context);
}
