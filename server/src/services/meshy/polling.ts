import type { MeshyTaskStatus } from '@prisma/client';
import { env } from '../../config/env';
import { upsertMeshyJob } from '../../repositories/job.repository';
import { AppError } from '../../utils/AppError';
import { assertNever } from '../../utils/exhaustive';
import { toInputJson } from '../../utils/json';
import { sleep } from '../../utils/sleep';
import { meshyClient } from './meshy.client';
import type { MeshyMultiImageTask, MeshyRiggingTask, MeshyRemoteStatus } from './meshy.types';

function mapMeshyStatus(status: MeshyRemoteStatus): MeshyTaskStatus {
  switch (status) {
    case 'PENDING':
      return 'PENDING';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELED':
      return 'CANCELED';
    default:
      return assertNever(status);
  }
}

function terminalFailureMessage(taskError?: { message?: string }): string {
  const message = taskError?.message?.trim();
  return message && message.length > 0 ? message : 'Meshy task failed.';
}

export async function pollMeshyTask(
  jobId: string,
  taskId: string,
): Promise<MeshyMultiImageTask> {
  for (let attempt = 1; attempt <= env.MESHY_MAX_POLL_ATTEMPTS; attempt++) {
    const task = await meshyClient.get<MeshyMultiImageTask>(
      `/openapi/v1/multi-image-to-3d/${taskId}`,
    );

    await upsertMeshyJob({
      jobId,
      kind: 'MULTI_IMAGE_TO_3D',
      taskId,
      status: mapMeshyStatus(task.status),
      progress: task.progress ?? 0,
      modelUrl: task.model_urls?.glb ?? null,
      error: task.status === 'FAILED' || task.status === 'CANCELED'
        ? terminalFailureMessage(task.task_error)
        : null,
      raw: toInputJson(task),
    });

    if (task.status === 'SUCCEEDED') {
      return task;
    }

    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new AppError('MESHY_ERROR', terminalFailureMessage(task.task_error), 502);
    }

    await sleep(env.MESHY_POLL_INTERVAL_MS);
  }

  throw new AppError(
    'MESHY_ERROR',
    `Meshy multi-image-to-3d task timed out after ${env.MESHY_MAX_POLL_ATTEMPTS} attempts.`,
    504,
  );
}

export async function pollRiggingTask(jobId: string, taskId: string): Promise<MeshyRiggingTask> {
  for (let attempt = 1; attempt <= env.MESHY_MAX_POLL_ATTEMPTS; attempt++) {
    const task = await meshyClient.get<MeshyRiggingTask>(`/openapi/v1/rigging/${taskId}`);

    await upsertMeshyJob({
      jobId,
      kind: 'RIGGING',
      taskId,
      status: mapMeshyStatus(task.status),
      progress: task.progress ?? 0,
      modelUrl: task.result?.rigged_character_glb_url ?? null,
      error: task.status === 'FAILED' || task.status === 'CANCELED'
        ? terminalFailureMessage(task.task_error)
        : null,
      raw: toInputJson(task),
    });

    if (task.status === 'SUCCEEDED') {
      return task;
    }

    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new AppError('MESHY_ERROR', terminalFailureMessage(task.task_error), 502);
    }

    await sleep(env.MESHY_POLL_INTERVAL_MS);
  }

  throw new AppError(
    'MESHY_ERROR',
    `Meshy rigging task timed out after ${env.MESHY_MAX_POLL_ATTEMPTS} attempts.`,
    504,
  );
}
