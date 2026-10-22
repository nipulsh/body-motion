import { env } from '../../config/env';
import { supabaseAdmin } from './supabase.client';
import { patientStoragePrefix } from './paths';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';

export async function uploadObject(
  bucket: string,
  storagePath: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(bucket).upload(storagePath, data, {
    contentType,
    upsert: true,
  });

  if (error) {
    logger.error('Storage upload failed', { bucket, storagePath, error: error.message });
    throw new AppError('STORAGE_ERROR', `Failed to upload file: ${error.message}`, 502, {
      expose: true,
    });
  }
}

export async function createSignedUrl(bucket: string, storagePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(storagePath, env.SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new AppError(
      'STORAGE_ERROR',
      `Failed to create signed URL: ${error?.message ?? 'unknown error'}`,
      502,
      { expose: true },
    );
  }

  return data.signedUrl;
}

export async function downloadObject(bucket: string, storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(storagePath);

  if (error || !data) {
    throw new AppError(
      'STORAGE_ERROR',
      `Failed to download file: ${error?.message ?? 'unknown error'}`,
      502,
      { expose: true },
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteObjects(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const uniquePaths = [...new Set(paths)];
  const { error } = await supabaseAdmin.storage.from(bucket).remove(uniquePaths);

  if (error) {
    logger.error('Storage delete failed', { bucket, count: uniquePaths.length, error: error.message });
    throw new AppError('STORAGE_ERROR', `Failed to delete storage objects: ${error.message}`, 502, {
      expose: true,
    });
  }
}

export async function deletePatientStorage(
  patientId: string,
  legacyUserIds: string[] = [],
): Promise<void> {
  const prefixes = [patientStoragePrefix(patientId)];
  for (const userId of legacyUserIds) {
    prefixes.push(`${userId}/${patientId}`);
  }
  const buckets = [
    env.SUPABASE_BUCKET_PATIENT_IMAGES,
    env.SUPABASE_BUCKET_GENERATED_IMAGES,
    env.SUPABASE_BUCKET_MODELS,
  ];

  for (const bucket of buckets) {
    const paths = await listAllObjectPaths(bucket, prefixes);
    if (paths.length > 0) {
      await deleteObjects(bucket, paths);
    }
  }
}

async function listAllObjectPaths(bucket: string, prefixes: string[]): Promise<string[]> {
  const collected: string[] = [];

  for (const prefix of prefixes) {
    await walkPrefix(bucket, prefix, collected);
  }

  return collected;
}

async function walkPrefix(bucket: string, prefix: string, collected: string[]): Promise<void> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) {
    logger.warn('Storage list failed during patient delete', { bucket, prefix, error: error.message });
    return;
  }

  for (const entry of data ?? []) {
    const fullPath = `${prefix}/${entry.name}`;
    if (entry.id) {
      collected.push(fullPath);
    } else {
      await walkPrefix(bucket, fullPath, collected);
    }
  }
}

export function toDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function ensureStorageBuckets(): Promise<void> {
  const required = [
    env.SUPABASE_BUCKET_PATIENT_IMAGES,
    env.SUPABASE_BUCKET_GENERATED_IMAGES,
    env.SUPABASE_BUCKET_MODELS,
  ];

  const { data, error } = await supabaseAdmin.storage.listBuckets();
  if (error) {
    logger.error('[ERROR]', {
      stage: 'SUPABASE_STORAGE',
      status: 502,
      errorName: error.name,
      message: error.message,
    });
    throw new AppError('STORAGE_ERROR', `Failed to list storage buckets: ${error.message}`, 502, {
      expose: true,
    });
  }

  const existing = new Set((data ?? []).map((bucket) => bucket.name));
  for (const name of required) {
    if (existing.has(name)) {
      logger.info('Storage bucket ready', { bucket: name });
      continue;
    }

    const { error: createError } = await supabaseAdmin.storage.createBucket(name, {
      public: false,
    });
    if (createError && !/already exists/i.test(createError.message)) {
      logger.error('[ERROR]', {
        stage: 'SUPABASE_STORAGE',
        status: 502,
        errorName: createError.name,
        message: createError.message,
        bucket: name,
      });
      throw new AppError(
        'STORAGE_ERROR',
        `Failed to create storage bucket "${name}": ${createError.message}`,
        502,
        { expose: true },
      );
    }
    logger.info('Created private storage bucket', { bucket: name });
  }
}
