import type { ScanType } from '@prisma/client';

export const BODY_360_IMAGE_LIMITS = { min: 30, max: 40 } as const;
export const TIMED_BURST_IMAGE_LIMITS = { min: 80, max: 80 } as const;

/** Multer `files` cap — highest per-scan-type batch size. */
export const MAX_SCAN_UPLOAD_FILES = TIMED_BURST_IMAGE_LIMITS.max;

export function imageLimitsForScanType(type: ScanType): { min: number; max: number } {
  if (type === 'TIMED_BURST') return TIMED_BURST_IMAGE_LIMITS;
  return BODY_360_IMAGE_LIMITS;
}
