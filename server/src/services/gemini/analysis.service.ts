import { createPartFromUri, createUserContent, type Part } from '@google/genai';
import { toJSONSchema } from 'zod';
import { env } from '../../config/env';
import {
  listCatalogueMuscleNames,
  lookupMuscle,
} from '../../config/muscleMap';
import { geminiAnalysisSchema, type GeminiAnalysis } from '../../schemas/analysis.schema';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { toInputJson } from '../../utils/json';
import { logger } from '../../utils/logger';
import { sleep } from '../../utils/sleep';
import { getGeminiClient } from './gemini.client';

export interface PatientImageInput {
  buffer: Buffer;
  mimeType: string;
  label: string;
}

function buildAnalysisSystemPrompt(): string {
  const catalogue = listCatalogueMuscleNames().join(', ');
  return `You are an AI assistant helping clinicians explore possible muscular contributors to observed body posture and shape changes.

IMPORTANT DISCLAIMERS — follow strictly:
- You are NOT providing a medical diagnosis.
- Use language such as "likely contributing muscle", "possible contributing muscle", "observed deformation", and "AI-estimated likelihood".
- Never claim medical proof or certainty about causation.
- Analyse all supplied images together as one capture session of the same person.

MUSCLE NAMING (critical):
- Every muscle "name" you return MUST match an entry from this BodyParts3D catalogue exactly (including Left/Right prefix when present):
${catalogue}
- Prefer the most specific catalogue name that explains the observed deformation (e.g. "Left Deltoid" not a vague regional label).
- If several heads/parts of one muscle are implicated, still return the catalogue muscle name; the app maps it to mesh components.
- Do not invent muscle names outside the catalogue.

Identify:
- body region affected
- observed deformation (neutral, descriptive terms — be concrete about asymmetry, atrophy, hypertrophy, winging, tilt, etc.)
- affected side (left, right, bilateral, midline, or unknown)
- multiple likely contributing muscles when appropriate
- for each muscle: deformation type, likelihood (0-1), intensity (0-1), and brief reason

Return JSON matching the provided schema exactly.`;
}

function buildImageParts(images: PatientImageInput[]): Part[] {
  const parts: Part[] = [
    {
      text:
        `${buildAnalysisSystemPrompt()}\n\n` +
        `Analyse the following ${images.length} images together.`,
    },
  ];

  for (const image of images) {
    parts.push({ text: image.label });
    parts.push({
      inlineData: {
        data: image.buffer.toString('base64'),
        mimeType: image.mimeType,
      },
    });
  }

  return parts;
}

function estimateInlineBytes(images: PatientImageInput[]): number {
  return images.reduce((sum, image) => sum + image.buffer.length, 0);
}

async function waitForFileActive(fileName: string): Promise<{ uri: string; mimeType: string }> {
  const ai = getGeminiClient();
  const deadline = Date.now() + env.GEMINI_FILE_ACTIVE_TIMEOUT_MS;

  let current = await ai.files.get({ name: fileName });

  while (current.state !== 'ACTIVE') {
    if (current.state === 'FAILED') {
      throw new AppError(
        'GEMINI_ERROR',
        `Gemini file processing failed: ${current.error?.message ?? 'unknown error'}`,
        502,
      );
    }
    if (Date.now() >= deadline) {
      throw new AppError('GEMINI_ERROR', 'Timed out waiting for Gemini file to become ACTIVE.', 504);
    }
    await sleep(1000);
    current = await ai.files.get({ name: fileName });
  }

  if (!current.uri || !current.mimeType) {
    throw new AppError('GEMINI_ERROR', 'Gemini file is ACTIVE but missing uri or mimeType.', 502);
  }

  return { uri: current.uri, mimeType: current.mimeType };
}

async function buildFileApiParts(images: PatientImageInput[]): Promise<Part[]> {
  const ai = getGeminiClient();
  const uploaded: Array<{ label: string; uri: string; mimeType: string }> = [];

  for (const image of images) {
    const file = await ai.files.upload({
      file: new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      config: { mimeType: image.mimeType, displayName: image.label },
    });

    if (!file.name) {
      throw new AppError('GEMINI_ERROR', 'Gemini file upload did not return a resource name.', 502);
    }

    const active = await waitForFileActive(file.name);
    uploaded.push({ label: image.label, uri: active.uri, mimeType: active.mimeType });
  }

  const parts: Part[] = [
    {
      text:
        `${buildAnalysisSystemPrompt()}\n\n` +
        `Analyse the following ${images.length} images together.`,
    },
  ];

  for (const item of uploaded) {
    parts.push({ text: item.label });
    parts.push(createPartFromUri(item.uri, item.mimeType));
  }

  return parts;
}

function resolveUploadMode(images: PatientImageInput[]): 'inline' | 'files' {
  if (env.GEMINI_UPLOAD_MODE === 'inline') return 'inline';
  if (env.GEMINI_UPLOAD_MODE === 'files') return 'files';
  return estimateInlineBytes(images) > env.GEMINI_INLINE_BUDGET_BYTES ? 'files' : 'inline';
}

export interface AnalysisRunResult {
  parsed: GeminiAnalysis;
  rawResponse: Prisma.InputJsonValue;
  modelName: string;
  enrichedMuscles: Array<
    GeminiAnalysis['muscles'][number] & {
      bodyExplorerId: string;
      bodyExplorerMeshNames: string[];
    }
  >;
}

export async function runGeminiAnalysis(images: PatientImageInput[]): Promise<AnalysisRunResult> {
  const ai = getGeminiClient();
  const uploadMode = resolveUploadMode(images);
  logger.info('Starting Gemini analysis', { imageCount: images.length, uploadMode });

  const parts =
    uploadMode === 'files' ? await buildFileApiParts(images) : buildImageParts(images);

  const response = await ai.models.generateContent({
    model: env.GEMINI_ANALYSIS_MODEL,
    contents: createUserContent(parts),
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: toJSONSchema(geminiAnalysisSchema),
    },
  });

  const text = response.text;
  if (!text) {
    throw new AppError('GEMINI_ERROR', 'Gemini returned an empty analysis response.', 502);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new AppError('GEMINI_ERROR', 'Gemini returned non-JSON analysis output.', 502);
  }

  const parsed = geminiAnalysisSchema.parse(parsedJson);

  const enrichedMuscles = parsed.muscles.map((muscle) => {
    const mapped = lookupMuscle(muscle.name);
    const catalogueName = mapped?.catalogueName ?? muscle.name;
    return {
      ...muscle,
      // Prefer catalogue / component name so the UI and 3D viewer share one vocabulary.
      name: catalogueName,
      bodyExplorerId: mapped?.bodyExplorerId ?? '',
      bodyExplorerMeshNames: mapped?.bodyExplorerMeshNames ?? [],
    };
  });

  const remappedParsed: GeminiAnalysis = {
    ...parsed,
    muscles: enrichedMuscles.map((muscle) => ({
      name: muscle.name,
      side: muscle.side,
      likelihood: muscle.likelihood,
      deformation: muscle.deformation,
      intensity: muscle.intensity,
      reason: muscle.reason,
    })),
  };

  const rawResponse = toInputJson({
    model: env.GEMINI_ANALYSIS_MODEL,
    uploadMode,
    candidates: response.candidates,
    usageMetadata: response.usageMetadata,
    parsedText: text,
  });

  return {
    parsed: remappedParsed,
    rawResponse,
    modelName: env.GEMINI_ANALYSIS_MODEL,
    enrichedMuscles,
  };
}
