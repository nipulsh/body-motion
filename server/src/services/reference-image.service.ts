import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export interface ReferenceImage {
  absolutePath: string;
  mimeType: string;
  buffer: Buffer;
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      throw new AppError(
        'CONFIGURATION_ERROR',
        `Unsupported reference image extension "${ext}". Use PNG, JPEG, or WEBP.`,
        500,
      );
  }
}

/** Loads the configured reference model image. Throws if missing or unreadable. */
export function loadReferenceModelImage(): ReferenceImage {
  const absolutePath = env.referenceModelImageAbsolutePath;

  if (!fs.existsSync(absolutePath)) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      `Reference model image not found at ${absolutePath}. ` +
        'Place the asset on the server or set REFERENCE_MODEL_IMAGE_PATH. See src/assets/README.md.',
      500,
    );
  }

  const buffer = fs.readFileSync(absolutePath);
  if (buffer.length === 0) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      `Reference model image at ${absolutePath} is empty.`,
      500,
    );
  }

  return {
    absolutePath,
    mimeType: detectMimeType(absolutePath),
    buffer,
  };
}
