import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Video } from '@google/genai';
import { env } from '../../config/env';
import type { Exercise } from '../../schemas/exercise.schema';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { loadReferenceModelImage } from '../reference-image.service';
import {
  createSignedUrl,
  downloadObject,
  uploadObject,
} from '../storage/storage.service';
import { getGeminiClient } from './gemini.client';
import { mapGeminiClientError } from './geminiError';
import { buildExerciseDemoVideoPrompt } from './exercise-video-prompt';

const DEMO_PREFIX = 'exercise-demos';

/** Gemini API (AI Studio) video models — not Vertex `veo-*-001` IDs. */
const GEMINI_API_VIDEO_MODEL_FALLBACKS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.0-generate-preview',
] as const;

function videoModelCandidates(): string[] {
  const configured = env.GEMINI_VIDEO_MODEL.trim();
  const ordered = [configured, ...GEMINI_API_VIDEO_MODEL_FALLBACKS];
  return [...new Set(ordered.filter(Boolean))];
}

function isUnavailableVideoModelError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /not found/i.test(message) ||
    /NOT_FOUND/i.test(message) ||
    /not supported for predictlongrunning/i.test(message)
  );
}

function demoStoragePath(exerciseId: string): string {
  return `${DEMO_PREFIX}/${exerciseId}.mp4`;
}

async function readCachedDemoUrl(exerciseId: string): Promise<string | null> {
  const storagePath = demoStoragePath(exerciseId);
  const bucket = env.SUPABASE_BUCKET_GENERATED_IMAGES;
  try {
    await downloadObject(bucket, storagePath);
    return await createSignedUrl(bucket, storagePath);
  } catch {
    return null;
  }
}

async function bufferFromVideo(video: Video): Promise<Buffer> {
  if (video.videoBytes) {
    return Buffer.from(video.videoBytes, 'base64');
  }

  if (!video.uri) {
    throw new AppError('GEMINI_ERROR', 'Video generation returned no video data.', 502, { expose: true });
  }

  const ai = getGeminiClient();
  const tmpPath = path.join(os.tmpdir(), `exercise-demo-${randomUUID()}.mp4`);
  try {
    await ai.files.download({ file: video, downloadPath: tmpPath });
    return await fs.readFile(tmpPath);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

async function pollVideoOperation(
  operation: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['models']['generateVideos']>>,
): Promise<Video> {
  const ai = getGeminiClient();
  const deadline = Date.now() + env.GEMINI_VIDEO_TIMEOUT_MS;
  let current = operation;

  while (!current.done) {
    if (Date.now() > deadline) {
      throw new AppError(
        'GEMINI_ERROR',
        'Video generation timed out. Try again in a moment.',
        504,
        { expose: true },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, env.GEMINI_VIDEO_POLL_INTERVAL_MS));
    current = await ai.operations.getVideosOperation({ operation: current });
  }

  if (current.error) {
    throw new AppError(
      'GEMINI_ERROR',
      'Video generation failed.',
      502,
      { expose: true, cause: current.error },
    );
  }

  const video = current.response?.generatedVideos?.[0]?.video;
  if (!video) {
    const reasons = current.response?.raiMediaFilteredReasons?.join('; ');
    throw new AppError(
      'GEMINI_ERROR',
      reasons ? `Video was blocked: ${reasons}` : 'Video generation returned no output.',
      502,
      { expose: true },
    );
  }

  return video;
}

export async function getOrCreateExerciseDemoVideo(
  exercise: Exercise,
): Promise<{ exerciseId: string; demoVideoUrl: string; cached: boolean }> {
  const cachedUrl = await readCachedDemoUrl(exercise.id);
  if (cachedUrl) {
    return { exerciseId: exercise.id, demoVideoUrl: cachedUrl, cached: true };
  }

  const ai = getGeminiClient();
  const prompt = buildExerciseDemoVideoPrompt(exercise);

  let reference: ReturnType<typeof loadReferenceModelImage> | null = null;
  try {
    reference = loadReferenceModelImage();
  } catch (err) {
    logger.warn('Exercise demo video: reference image unavailable, using text-only generation', {
      exerciseId: exercise.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const source: {
    prompt: string;
    image?: { imageBytes: string; mimeType: string };
  } = { prompt };

  if (reference) {
    source.image = {
      imageBytes: reference.buffer.toString('base64'),
      mimeType: reference.mimeType,
    };
  }

  const models = videoModelCandidates();
  logger.info('Generating exercise demo video', {
    exerciseId: exercise.id,
    models,
    hasReferenceImage: Boolean(reference),
  });

  let operation: Awaited<ReturnType<typeof ai.models.generateVideos>> | null = null;
  let lastModelError: unknown = null;

  for (const model of models) {
    try {
      operation = await ai.models.generateVideos({
        model,
        source,
        config: {
          numberOfVideos: 1,
          durationSeconds: 6,
          aspectRatio: '9:16',
        },
      });
      logger.info('Exercise demo video model accepted', { exerciseId: exercise.id, model });
      break;
    } catch (err) {
      lastModelError = err;
      if (isUnavailableVideoModelError(err)) {
        logger.warn('Video model unavailable, trying fallback', {
          exerciseId: exercise.id,
          model,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      throw mapGeminiClientError(err, 'Exercise demo video');
    }
  }

  if (!operation) {
    throw mapGeminiClientError(
      lastModelError ?? new Error('No Veo video model is available for this API key.'),
      'Exercise demo video',
    );
  }

  const video = await pollVideoOperation(operation);
  const buffer = await bufferFromVideo(video);
  const mimeType = video.mimeType ?? 'video/mp4';
  const storagePath = demoStoragePath(exercise.id);
  const bucket = env.SUPABASE_BUCKET_GENERATED_IMAGES;

  await uploadObject(bucket, storagePath, buffer, mimeType);
  const demoVideoUrl = await createSignedUrl(bucket, storagePath);

  return { exerciseId: exercise.id, demoVideoUrl, cached: false };
}
