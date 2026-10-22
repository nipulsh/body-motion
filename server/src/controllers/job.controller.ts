import type { Request, Response } from 'express';
import { API_VIEW_ORDER, VIEW_TO_API } from '../config/constants';
import { findPatientForHospital } from '../repositories/patient.repository';
import {
  findAnalysisResult,
  findJobForHospital,
  findJobWithRelations,
  listGeneratedImages,
  updateJobProgress,
} from '../repositories/job.repository';
import { geminiAnalysisSchema } from '../schemas/analysis.schema';
import { jobIdParamSchema } from '../schemas/common.schema';
import { exerciseGenerationRequestSchema } from '../schemas/exercise.schema';
import {
  buildAnalysisInputFromResult,
  runGeminiExerciseGeneration,
} from '../services/gemini/exercise.service';
import { enqueueAnalysisJob } from '../services/jobs/jobRunner';
import { syncScanStatusForJob } from '../services/scans/scanProcess.service';
import { createSignedUrl } from '../services/storage/storage.service';
import type {
  GenerateExercisesResponse,
  GeneratedImageResponseItem,
  JobStatusResponse,
  ModelResponse,
} from '../types/api';
import { AppError } from '../utils/AppError';
import { prismaSideToApi } from '../utils/bodySide';
import { asyncHandler } from '../utils/asyncHandler';
import { requireHospitalForUser } from '../utils/requireHospital';

async function requireJobForAuth(jobId: string, userId: string) {
  const hospital = await requireHospitalForUser(userId);
  const job = await findJobForHospital(jobId, hospital.id);
  if (!job) throw AppError.notFound('Job not found.');
  return job;
}

export const getJobStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const { jobId } = jobIdParamSchema.parse(req.params);
  const job = await requireJobForAuth(jobId, auth.userId);

  const body: JobStatusResponse = {
    jobId: job.id,
    patientId: job.patientId,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
  res.json(body);
});

export const getJobAnalysisHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const { jobId } = jobIdParamSchema.parse(req.params);
  await requireJobForAuth(jobId, auth.userId);

  const result = await findAnalysisResult(jobId);
  if (!result) throw AppError.notFound('Analysis is not available for this job yet.');

  res.json({
    bodyRegion: result.bodyRegion,
    observedDeformation: result.observedDeformation,
    affectedSide: prismaSideToApi(result.affectedSide),
    summary: result.summary,
    muscles: result.muscleFindings.map((muscle) => ({
      name: muscle.name,
      side: prismaSideToApi(muscle.side),
      likelihood: muscle.likelihood,
      deformation: muscle.deformation,
      intensity: muscle.intensity,
      reason: muscle.reason,
      bodyExplorerId: muscle.bodyExplorerId || undefined,
      bodyExplorerMeshNames:
        muscle.bodyExplorerMeshNames.length > 0 ? muscle.bodyExplorerMeshNames : undefined,
    })),
  });
});

export const getGeneratedImagesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const { jobId } = jobIdParamSchema.parse(req.params);
  await requireJobForAuth(jobId, auth.userId);

  const stored = await listGeneratedImages(jobId);
  const byView = new Map(stored.map((image) => [image.view, image]));

  const ordered = await Promise.all(
    API_VIEW_ORDER.map(async (view): Promise<GeneratedImageResponseItem | null> => {
      const image = byView.get(view);
      if (!image) return null;
      return {
        view: VIEW_TO_API[view],
        url: await createSignedUrl(image.bucket, image.storagePath),
      };
    }),
  );

  const images = ordered.filter((item): item is GeneratedImageResponseItem => item !== null);
  res.json({ images });
});

export const getJobModelHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const { jobId } = jobIdParamSchema.parse(req.params);
  await requireJobForAuth(jobId, auth.userId);

  const job = await findJobWithRelations(jobId);
  if (!job) throw AppError.notFound('Job not found.');

  const modelTask = job.meshyJobs.find((entry) => entry.kind === 'MULTI_IMAGE_TO_3D');
  const rigTask = job.meshyJobs.find((entry) => entry.kind === 'RIGGING');

  let glbUrl: string | null = null;
  let riggedGlbUrl: string | null = null;

  if (modelTask?.storagePath && modelTask.bucket) {
    glbUrl = await createSignedUrl(modelTask.bucket, modelTask.storagePath);
  }

  if (rigTask?.storagePath && rigTask.bucket) {
    riggedGlbUrl = await createSignedUrl(rigTask.bucket, rigTask.storagePath);
  }

  const body: ModelResponse = { glbUrl, riggedGlbUrl };
  res.json(body);
});

export const generateJobExercisesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const { jobId } = jobIdParamSchema.parse(req.params);
  const body = exerciseGenerationRequestSchema.parse(req.body ?? {});

  const hospital = await requireHospitalForUser(auth.userId);
  const job = await findJobForHospital(jobId, hospital.id);
  if (!job) throw AppError.notFound('Job not found.');

  let analysis;
  if (body.analysis) {
    analysis = geminiAnalysisSchema.parse(body.analysis);
  } else {
    const result = await findAnalysisResult(jobId);
    if (!result) throw AppError.notFound('Analysis is not available for this job yet.');
    analysis = buildAnalysisInputFromResult(result);
  }

  const patient = await findPatientForHospital(job.patientId, hospital.id);

  const { plan, modelName } = await runGeminiExerciseGeneration({
    analysis,
    patient: patient
      ? {
          deformities: patient.deformities,
          chronicConditions: patient.chronicConditions,
          notes: patient.notes,
        }
      : undefined,
  });

  const response: GenerateExercisesResponse = {
    jobId,
    modelName,
    exercises: plan.exercises,
  };
  res.json(response);
});

export const retryJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const { jobId } = jobIdParamSchema.parse(req.params);
  const job = await requireJobForAuth(jobId, auth.userId);

  if (job.status !== 'FAILED') {
    throw AppError.conflict('Only failed jobs can be retried.');
  }

  await updateJobProgress(jobId, {
    status: 'QUEUED',
    error: null,
    failedStep: null,
    currentStep: null,
    progress: 0,
  });

  if (job.scanId) {
    await syncScanStatusForJob(job.scanId, { status: 'QUEUED' });
  }

  enqueueAnalysisJob(jobId);

  res.status(202).json({
    jobId: job.id,
    status: 'QUEUED',
    message: 'Job retry queued. Processing resumes from the last incomplete step.',
  });
});
