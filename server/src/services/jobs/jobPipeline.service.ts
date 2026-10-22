import type { PipelineStep, ScanType } from '@prisma/client';
import {
  API_VIEW_ORDER,
  GENERATED_IMAGE_VIEWS,
  STEP_CURRENT_LABEL,
  STEP_PROGRESS,
  STEP_STATUS,
} from '../../config/constants';
import { env } from '../../config/env';
import { pipelineStepsForJob } from '../../config/pipelineSteps';
import {
  findJobById,
  findJobWithRelations,
  listJobImages,
  markJobCompleted,
  markJobFailed,
  markJobStarted,
  saveAnalysisResult,
  updateJobProgress,
  upsertGeneratedImage,
  upsertMeshyJob,
  type JobWithRelations,
} from '../../repositories/job.repository';
import { upsertScanPatientModel } from '../../repositories/scan.repository';
import { syncScanStatusForJob } from '../scans/scanProcess.service';
import { AppError, toErrorMessage } from '../../utils/AppError';
import { apiSideToPrisma } from '../../utils/bodySide';
import { assertNever } from '../../utils/exhaustive';
import { geminiAnalysisSchema } from '../../schemas/analysis.schema';
import { toInputJson } from '../../utils/json';
import { logger } from '../../utils/logger';
import {
  buildGeminiAnalysisInputs,
  selectGeminiAnalysisFrameIndexes,
} from '../gemini/analysisFrameSelection';
import { runGeminiAnalysis } from '../gemini/analysis.service';
import {
  generateReferenceImages,
  planPatientDeformityReferences,
  planSequencePatientReferences,
} from '../image-generation/image-generation.service';
import { createAndPollMultiImageTo3d } from '../meshy/multiImageTo3d.service';
import { createAndPollRigging } from '../meshy/rigging.service';
import { loadReferenceModelImage } from '../reference-image.service';
import {
  createSignedUrl,
  downloadObject,
  uploadObject,
} from '../storage/storage.service';
import { generatedImagePath, modelPath } from '../storage/paths';

function scanTypeFromJob(job: JobWithRelations): ScanType {
  return job.scan?.type ?? 'BODY_360';
}

export function determineStartStep(job: JobWithRelations): PipelineStep | null {
  if (!job.analysisResult) return 'ANALYSIS';

  if (!env.meshyEnabled) {
    return null;
  }

  const generatedCount = job.generatedImages.length;
  if (generatedCount < GENERATED_IMAGE_VIEWS.length) return 'IMAGE_GENERATION';

  const modelTask = job.meshyJobs.find((entry) => entry.kind === 'MULTI_IMAGE_TO_3D');
  if (!modelTask || modelTask.status !== 'SUCCEEDED' || !modelTask.storagePath) {
    return 'MODEL_GENERATION';
  }

  const rigTask = job.meshyJobs.find((entry) => entry.kind === 'RIGGING');
  if (!rigTask || rigTask.status !== 'SUCCEEDED' || !rigTask.storagePath) {
    return 'RIGGING';
  }

  return null;
}

function stepsFrom(start: PipelineStep): PipelineStep[] {
  const steps = pipelineStepsForJob();
  const index = steps.indexOf(start);
  if (index < 0) {
    return [];
  }
  return steps.slice(index);
}

async function setStepStarted(jobId: string, step: PipelineStep): Promise<void> {
  await updateJobProgress(jobId, {
    status: STEP_STATUS[step],
    progress: STEP_PROGRESS[step].start,
    currentStep: STEP_CURRENT_LABEL[step],
  });

  const job = await findJobById(jobId);
  if (job?.scanId) {
    await syncScanStatusForJob(job.scanId, {
      status: STEP_STATUS[step],
      failedStep: step,
    });
  }
}

async function setStepCompleted(jobId: string, step: PipelineStep): Promise<void> {
  await updateJobProgress(jobId, {
    progress: STEP_PROGRESS[step].end,
    currentStep: STEP_CURRENT_LABEL[step],
  });
}

async function downloadRemoteGlb(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError('MESHY_ERROR', `Failed to download Meshy GLB (${response.status}).`, 502);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function mirrorGlb(
  userId: string,
  patientId: string,
  jobId: string,
  sourceUrl: string,
  fileName: string,
): Promise<{ bucket: string; storagePath: string }> {
  const buffer = await downloadRemoteGlb(sourceUrl);
  const bucket = env.SUPABASE_BUCKET_MODELS;
  const storagePath = modelPath(userId, patientId, jobId, fileName);
  await uploadObject(bucket, storagePath, buffer, 'model/gltf-binary');
  return { bucket, storagePath };
}

async function runAnalysisStep(job: JobWithRelations): Promise<void> {
  await setStepStarted(job.id, 'ANALYSIS');

  const images = await listJobImages(job.id);
  const scanType = scanTypeFromJob(job);
  const frameIndexes = selectGeminiAnalysisFrameIndexes(scanType, images.length);
  const loaded = await Promise.all(
    frameIndexes.map(async (sourceIndex) => {
      const image = images[sourceIndex]!;
      return {
        buffer: await downloadObject(image.bucket, image.storagePath),
        mimeType: image.mimeType,
        angle: image.angle,
        orderIndex: image.orderIndex ?? sourceIndex,
      };
    }),
  );

  const inputs = buildGeminiAnalysisInputs(
    scanType,
    loaded,
    scanType === 'TIMED_BURST'
      ? { totalFrames: images.length, indexes: frameIndexes }
      : undefined,
  );

  const result = await runGeminiAnalysis(inputs);

  await saveAnalysisResult({
    jobId: job.id,
    bodyRegion: result.parsed.bodyRegion,
    observedDeformation: result.parsed.observedDeformation,
    affectedSide: apiSideToPrisma(result.parsed.affectedSide),
    summary: result.parsed.summary,
    modelName: result.modelName,
    parsed: result.parsed,
    rawResponse: result.rawResponse,
    findings: result.enrichedMuscles.map((muscle) => ({
      name: muscle.name,
      side: apiSideToPrisma(muscle.side),
      likelihood: muscle.likelihood,
      deformation: muscle.deformation,
      intensity: muscle.intensity,
      reason: muscle.reason,
      bodyExplorerId: muscle.bodyExplorerId,
      bodyExplorerMeshNames: muscle.bodyExplorerMeshNames,
    })),
  });

  await setStepCompleted(job.id, 'ANALYSIS');
}

async function runImageGenerationStep(job: JobWithRelations): Promise<void> {
  await setStepStarted(job.id, 'IMAGE_GENERATION');

  const reference = loadReferenceModelImage();
  const currentJob = await findJobWithRelations(job.id);
  if (!currentJob?.analysisResult) {
    throw new AppError('PIPELINE_ERROR', 'Analysis result missing before image generation.', 500);
  }

  const analysis = geminiAnalysisSchema.parse(currentJob.analysisResult.parsed);

  const patientImages = await listJobImages(job.id);
  const scanType = scanTypeFromJob(currentJob);
  // Keep Gemini under its practical input-image budget: model ref + patient refs (+ front later).
  const picks =
    scanType === 'TIMED_BURST'
      ? planSequencePatientReferences(patientImages, 2)
      : planPatientDeformityReferences(patientImages, 2);
  const patientReferences = await Promise.all(
    picks.map(async (pick) => {
      const image = patientImages[pick.index]!;
      return {
        buffer: await downloadObject(image.bucket, image.storagePath),
        mimeType: image.mimeType,
        label: pick.label,
      };
    }),
  );

  const generated = await generateReferenceImages(analysis, reference, patientReferences);

  for (const image of generated) {
    const bucket = env.SUPABASE_BUCKET_GENERATED_IMAGES;
    const storagePath = generatedImagePath(
      job.userId,
      job.patientId,
      job.id,
      image.view,
      image.extension,
    );
    await uploadObject(bucket, storagePath, image.buffer, image.mimeType);
    await upsertGeneratedImage({
      jobId: job.id,
      view: image.view,
      bucket,
      storagePath,
      mimeType: image.mimeType,
      prompt: image.prompt,
      modelName: env.GEMINI_IMAGE_MODEL,
    });
  }

  await setStepCompleted(job.id, 'IMAGE_GENERATION');
}

async function runModelGenerationStep(job: JobWithRelations): Promise<void> {
  await setStepStarted(job.id, 'MODEL_GENERATION');

  const currentJob = await findJobWithRelations(job.id);
  if (!currentJob) {
    throw new AppError('PIPELINE_ERROR', 'Job not found during model generation.', 500);
  }

  const viewMap = new Map(currentJob.generatedImages.map((image) => [image.view, image]));
  const orderedImages = API_VIEW_ORDER.map((view) => viewMap.get(view)).filter(
    (image): image is NonNullable<typeof image> => image !== undefined,
  );

  if (orderedImages.length !== GENERATED_IMAGE_VIEWS.length) {
    throw new AppError(
      'PIPELINE_ERROR',
      `Expected ${GENERATED_IMAGE_VIEWS.length} generated images before Meshy, found ${orderedImages.length}.`,
      500,
    );
  }

  const analysis = currentJob.analysisResult?.parsed
    ? geminiAnalysisSchema.safeParse(currentJob.analysisResult.parsed)
    : null;

  const meshyTask = await createAndPollMultiImageTo3d(
    job.id,
    orderedImages.map((image) => ({
      bucket: image.bucket,
      storagePath: image.storagePath,
      mimeType: image.mimeType,
    })),
    analysis?.success ? analysis.data : null,
  );

  const glbUrl = meshyTask.model_urls?.glb;
  if (!glbUrl) {
    throw new AppError('MESHY_ERROR', 'Meshy succeeded but did not return a GLB URL.', 502);
  }

  const stored = await mirrorGlb(job.userId, job.patientId, job.id, glbUrl, 'model.glb');

  await upsertMeshyJob({
    jobId: job.id,
    kind: 'MULTI_IMAGE_TO_3D',
    taskId: meshyTask.id,
    status: 'SUCCEEDED',
    progress: 100,
    modelUrl: glbUrl,
    bucket: stored.bucket,
    storagePath: stored.storagePath,
    error: null,
    raw: toInputJson(meshyTask),
  });

  await setStepCompleted(job.id, 'MODEL_GENERATION');
}

async function runRiggingStep(job: JobWithRelations): Promise<void> {
  await setStepStarted(job.id, 'RIGGING');

  const currentJob = await findJobWithRelations(job.id);
  const modelTask = currentJob?.meshyJobs.find((entry) => entry.kind === 'MULTI_IMAGE_TO_3D');
  if (!modelTask?.bucket || !modelTask.storagePath) {
    throw new AppError('PIPELINE_ERROR', 'Mirrored GLB missing before rigging.', 500);
  }

  // Rig from our own mirrored copy: Meshy's asset URLs expire after 3 days, which would
  // otherwise break retries of a job whose model stage succeeded days earlier.
  const modelUrl = await createSignedUrl(modelTask.bucket, modelTask.storagePath);
  const rigTask = await createAndPollRigging(job.id, modelUrl);
  const riggedUrl = rigTask.result?.rigged_character_glb_url;
  if (!riggedUrl) {
    throw new AppError('MESHY_ERROR', 'Meshy rigging succeeded but did not return a rigged GLB URL.', 502);
  }

  const stored = await mirrorGlb(job.userId, job.patientId, job.id, riggedUrl, 'rigged.glb');

  await upsertMeshyJob({
    jobId: job.id,
    kind: 'RIGGING',
    taskId: rigTask.id,
    status: 'SUCCEEDED',
    progress: 100,
    modelUrl: riggedUrl,
    bucket: stored.bucket,
    storagePath: stored.storagePath,
    error: null,
    raw: toInputJson(rigTask),
  });

  await setStepCompleted(job.id, 'RIGGING');
}

async function persistScanModels(job: JobWithRelations): Promise<void> {
  if (!job.scanId) return;

  const modelTask = job.meshyJobs.find((entry) => entry.kind === 'MULTI_IMAGE_TO_3D');
  const rigTask = job.meshyJobs.find((entry) => entry.kind === 'RIGGING');

  if (modelTask?.bucket && modelTask.storagePath) {
    await upsertScanPatientModel({
      patientId: job.patientId,
      scanId: job.scanId,
      bucket: modelTask.bucket,
      storagePath: modelTask.storagePath,
      fileName: 'model.glb',
    });
  }

  if (rigTask?.bucket && rigTask.storagePath) {
    await upsertScanPatientModel({
      patientId: job.patientId,
      scanId: job.scanId,
      bucket: rigTask.bucket,
      storagePath: rigTask.storagePath,
      fileName: 'rigged.glb',
    });
  }
}

async function runStep(job: JobWithRelations, step: PipelineStep): Promise<void> {
  switch (step) {
    case 'ANALYSIS':
      await runAnalysisStep(job);
      return;
    case 'IMAGE_GENERATION':
      await runImageGenerationStep(job);
      return;
    case 'MODEL_GENERATION':
      await runModelGenerationStep(job);
      return;
    case 'RIGGING':
      await runRiggingStep(job);
      return;
    default:
      assertNever(step);
  }
}

export async function processAnalysisJob(jobId: string): Promise<void> {
  const job = await findJobWithRelations(jobId);
  if (!job) {
    logger.error('Pipeline started for missing job', { jobId });
    return;
  }

  const startStep = determineStartStep(job);
  if (!startStep) {
    await markJobCompleted(jobId);
    if (job.scanId) {
      await syncScanStatusForJob(job.scanId, { status: 'COMPLETED', error: null });
      await persistScanModels(job);
    }
    return;
  }

  await markJobStarted(jobId);
  logger.info('Pipeline starting', { jobId, startStep });

  for (const step of stepsFrom(startStep)) {
    try {
      const latestJob = await findJobWithRelations(jobId);
      if (!latestJob) {
        throw new AppError('PIPELINE_ERROR', 'Job disappeared during pipeline execution.', 500);
      }
      await runStep(latestJob, step);
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      logger.error('Pipeline step failed', { jobId, step, message });
      await markJobFailed(jobId, step, message);
      const failedJob = await findJobById(jobId);
      if (failedJob?.scanId) {
        await syncScanStatusForJob(failedJob.scanId, {
          status: 'FAILED',
          failedStep: step,
          error: message,
        });
      }
      return;
    }
  }

  await markJobCompleted(jobId);
  const completedJob = await findJobWithRelations(jobId);
  if (completedJob?.scanId) {
    await syncScanStatusForJob(completedJob.scanId, { status: 'COMPLETED', error: null });
    await persistScanModels(completedJob);
  }
  logger.info('Pipeline completed', { jobId });
}
