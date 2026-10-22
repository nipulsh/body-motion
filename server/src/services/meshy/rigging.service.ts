import { env } from '../../config/env';
import { upsertMeshyJob } from '../../repositories/job.repository';
import { AppError } from '../../utils/AppError';
import { toInputJson } from '../../utils/json';
import { meshyClient } from './meshy.client';
import type { MeshyCreateTaskResponse, MeshyRiggingTask } from './meshy.types';
import { pollRiggingTask } from './polling';

/**
 * Meshy documents `input_task_id` only for its own Text/Image-to-3D tasks and never states
 * that a multi-image-to-3d task qualifies, so rigging is driven from `model_url` instead.
 * `modelUrl` must be a directly fetchable `.glb` whose character faces +Z.
 */
export async function createAndPollRigging(
  jobId: string,
  modelUrl: string,
): Promise<MeshyRiggingTask> {
  const created = await meshyClient.post<MeshyCreateTaskResponse>('/openapi/v1/rigging', {
    model_url: modelUrl,
    height_meters: env.MESHY_RIG_HEIGHT_METERS,
  });

  const taskId = created.result;
  if (!taskId) {
    throw new AppError('MESHY_ERROR', 'Meshy rigging did not return a task id.', 502);
  }

  await upsertMeshyJob({
    jobId,
    kind: 'RIGGING',
    taskId,
    status: 'PENDING',
    progress: 0,
    bucket: env.SUPABASE_BUCKET_MODELS,
    storagePath: null,
    modelUrl: null,
    error: null,
    raw: toInputJson(created),
  });

  return pollRiggingTask(jobId, taskId);
}
