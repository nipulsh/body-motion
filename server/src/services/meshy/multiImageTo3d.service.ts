import { env } from '../../config/env';
import { upsertMeshyJob } from '../../repositories/job.repository';
import type { GeminiAnalysis } from '../../schemas/analysis.schema';
import { AppError } from '../../utils/AppError';
import { toInputJson } from '../../utils/json';
import { downloadObject, toDataUri } from '../storage/storage.service';
import { meshyClient } from './meshy.client';
import type { MeshyCreateTaskResponse, MeshyMultiImageTask } from './meshy.types';
import { pollMeshyTask } from './polling';

export interface MeshyImageInput {
  bucket: string;
  storagePath: string;
  mimeType: string;
}

async function imageToDataUri(input: MeshyImageInput): Promise<string> {
  const buffer = await downloadObject(input.bucket, input.storagePath);
  return toDataUri(buffer, input.mimeType);
}

/** Build a Meshy texture_prompt (max 600 chars) that prioritizes deformity fidelity. */
export function buildMeshyTexturePrompt(analysis: GeminiAnalysis | null): string {
  if (!analysis) {
    return [
      'Full-body adult human anatomical reference.',
      'Preserve every asymmetric body contour and posture change exactly as shown in the input images.',
      'Do not symmetrize or normalize the body shape.',
    ].join(' ');
  }

  const muscles = analysis.muscles
    .slice(0, 4)
    .map((m) => `${m.name} (${m.side}): ${m.deformation}`)
    .join('; ');

  const prompt = [
    'Exact 3D reconstruction of the attached multi-view anatomical body images.',
    `Region: ${analysis.bodyRegion}.`,
    `Deformity (must match geometry): ${analysis.observedDeformation}.`,
    `Affected side: ${analysis.affectedSide}.`,
    muscles ? `Muscles: ${muscles}.` : '',
    'Preserve asymmetry, lean, atrophy/hypertrophy, and contour changes exactly; do not correct or symmetrize.',
  ]
    .filter(Boolean)
    .join(' ');

  return prompt.length <= 600 ? prompt : `${prompt.slice(0, 597)}...`;
}

export async function createAndPollMultiImageTo3d(
  jobId: string,
  images: MeshyImageInput[],
  analysis: GeminiAnalysis | null = null,
): Promise<MeshyMultiImageTask> {
  if (images.length < 1 || images.length > 4) {
    throw new AppError('MESHY_ERROR', 'Meshy multi-image-to-3d requires 1–4 images.', 400);
  }

  const imageUrls = await Promise.all(images.map((image) => imageToDataUri(image)));
  const texturePrompt = buildMeshyTexturePrompt(analysis);

  const created = await meshyClient.post<MeshyCreateTaskResponse>('/openapi/v1/multi-image-to-3d', {
    image_urls: imageUrls,
    ai_model: env.MESHY_AI_MODEL,
    // Meshy auto-rigging rejects untextured meshes, so texturing must stay enabled.
    should_texture: true,
    enable_pbr: env.MESHY_ENABLE_PBR,
    texture_prompt: texturePrompt,
    texture_resolution: env.MESHY_TEXTURE_RESOLUTION,
    should_remesh: true,
    target_polycount: env.MESHY_TARGET_POLYCOUNT,
    topology: 'triangle',
    // Empty pose_mode avoids forcing a symmetric T-pose that can erase asymmetric deformity.
    // Rigging still runs in a later step.
    pose_mode: '',
    target_formats: ['glb'],
  });

  const taskId = created.result;
  if (!taskId) {
    throw new AppError('MESHY_ERROR', 'Meshy did not return a task id.', 502);
  }

  await upsertMeshyJob({
    jobId,
    kind: 'MULTI_IMAGE_TO_3D',
    taskId,
    status: 'PENDING',
    progress: 0,
    bucket: env.SUPABASE_BUCKET_MODELS,
    storagePath: null,
    modelUrl: null,
    error: null,
    raw: toInputJson({ ...created, texture_prompt: texturePrompt, ai_model: env.MESHY_AI_MODEL }),
  });

  return pollMeshyTask(jobId, taskId);
}
