import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { patientStoragePrefix } from './paths';
import {
  createLocalSignedUrl,
  ensureLocalBuckets,
  listLocalObjectPaths,
  readLocalObject,
  removeLocalObjects,
  removeLocalPrefixes,
  writeLocalObject,
} from './local.storage';
import {
  createSupabaseSignedUrl,
  deleteSupabaseObjects,
  deleteSupabasePatientStorage,
  downloadSupabaseObject,
  ensureSupabaseBuckets,
  uploadSupabaseObject,
} from './supabase.storage';

function localBuckets(): string[] {
  return [
    env.SUPABASE_BUCKET_PATIENT_IMAGES,
    env.SUPABASE_BUCKET_GENERATED_IMAGES,
    env.SUPABASE_BUCKET_MODELS,
  ];
}

function wrapLocalError(action: string, error: unknown): never {
  if (error instanceof AppError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Local storage ${action} failed`, { error: message });
  throw new AppError('STORAGE_ERROR', `Failed to ${action}: ${message}`, 500, { expose: true });
}

export async function uploadObject(
  bucket: string,
  storagePath: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  if (env.STORAGE_DRIVER === 'supabase') {
    await uploadSupabaseObject(bucket, storagePath, data, contentType);
    return;
  }

  try {
    await writeLocalObject(env.localStorageDir, bucket, storagePath, data);
  } catch (error) {
    wrapLocalError('upload file', error);
  }
}

export async function createSignedUrl(bucket: string, storagePath: string): Promise<string> {
  if (env.STORAGE_DRIVER === 'supabase') {
    return createSupabaseSignedUrl(bucket, storagePath);
  }

  return createLocalSignedUrl({
    publicBaseUrl: env.publicBaseUrl,
    secret: env.localStorageSigningSecret,
    bucket,
    storagePath,
    ttlSeconds: env.SIGNED_URL_TTL_SECONDS,
  });
}

export async function downloadObject(bucket: string, storagePath: string): Promise<Buffer> {
  if (env.STORAGE_DRIVER === 'supabase') {
    return downloadSupabaseObject(bucket, storagePath);
  }

  try {
    return await readLocalObject(env.localStorageDir, bucket, storagePath);
  } catch (error) {
    wrapLocalError('download file', error);
  }
}

export async function deleteObjects(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  if (env.STORAGE_DRIVER === 'supabase') {
    await deleteSupabaseObjects(bucket, paths);
    return;
  }

  try {
    await removeLocalObjects(env.localStorageDir, bucket, [...new Set(paths)]);
  } catch (error) {
    wrapLocalError('delete storage objects', error);
  }
}

export async function deletePatientStorage(
  patientId: string,
  legacyUserIds: string[] = [],
): Promise<void> {
  if (env.STORAGE_DRIVER === 'supabase') {
    await deleteSupabasePatientStorage(patientId, legacyUserIds);
    return;
  }

  const prefixes = [patientStoragePrefix(patientId)];
  for (const userId of legacyUserIds) {
    prefixes.push(`${userId}/${patientId}`);
  }

  try {
    for (const bucket of localBuckets()) {
      const paths = await listLocalObjectPaths(env.localStorageDir, bucket, prefixes);
      if (paths.length > 0) {
        await removeLocalObjects(env.localStorageDir, bucket, paths);
      }
      await removeLocalPrefixes(env.localStorageDir, bucket, prefixes);
    }
  } catch (error) {
    wrapLocalError('delete patient storage', error);
  }
}

export function toDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function ensureStorageBuckets(): Promise<void> {
  if (env.STORAGE_DRIVER === 'supabase') {
    await ensureSupabaseBuckets();
    return;
  }

  await ensureLocalBuckets(env.localStorageDir, localBuckets());
  logger.info('Local storage ready', {
    driver: 'local',
    dir: env.localStorageDir,
    buckets: localBuckets(),
  });
}
