import type { Request, Response } from 'express';
import { env } from '../config/env';
import {
  findAnalysisResult,
  findLatestJobForScan,
} from '../repositories/job.repository';
import {
  createPatientModel,
  createScan,
  createScanImages,
  clearScanImagesForReupload,
  listPatientImagesForPatient,
  listPatientModelsForPatient,
  listScanImages,
  listScanModels,
  listScansForPatient,
  serializePatientImage,
  serializePatientModel,
  serializeScan,
  updateScanStatus,
} from '../repositories/scan.repository';
import { startScanProcessing } from '../services/scans/scanProcess.service';
import { patientIdParamSchema } from '../schemas/common.schema';
import { createScanBodySchema, scanIdParamSchema } from '../schemas/scan.schema';
import { scanImagePath, scanModelPath } from '../services/storage/paths';
import { createSignedUrl, deleteObjects, uploadObject } from '../services/storage/storage.service';
import type {
  CreateScanResponse,
  PatientAssetImageResponseItem,
  PatientAssetModelResponseItem,
  ScanSummary,
} from '../types/api';
import { AppError, toErrorMessage } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { prismaSideToApi } from '../utils/bodySide';
import { logger } from '../utils/logger';
import { requirePatientForHospital, requireScanForHospital } from '../utils/patientAccess';
import { prismaErrorLogFields } from '../utils/prismaError';
import { requireHospitalForUser } from '../utils/requireHospital';
import { parseUploadAngles } from '../utils/uploadAngles';
import { validateScanUploadedImages, validateUploadedModel } from '../middleware/upload.middleware';

async function signedImageItems(
  images: Awaited<ReturnType<typeof listScanImages>>,
): Promise<PatientAssetImageResponseItem[]> {
  return Promise.all(
    images.map(async (image) => ({
      ...serializePatientImage(image),
      url: await createSignedUrl(image.bucket, image.storagePath),
    })),
  );
}

async function signedModelItems(
  models: Awaited<ReturnType<typeof listScanModels>>,
): Promise<PatientAssetModelResponseItem[]> {
  return Promise.all(
    models.map(async (model) => ({
      ...serializePatientModel(model),
      url: await createSignedUrl(model.bucket, model.storagePath),
    })),
  );
}

export const createScanHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);
  await requirePatientForHospital(patientId, hospital.id);

  const body = createScanBodySchema.parse(req.body ?? {});

  let scan;
  try {
    scan = await createScan({
      patientId,
      type: body.type ?? 'BODY_360',
    });
  } catch (error) {
    logger.error('[ERROR]', {
      stage: 'CREATE_SCAN',
      status: 503,
      patientId,
      ...prismaErrorLogFields(error),
    });
    throw error;
  }

  const response: CreateScanResponse = {
    scanId: scan.id,
    status: scan.status,
    scan: serializeScan(scan),
  };
  res.status(201).json(response);
});

export const listPatientScansHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);
  await requirePatientForHospital(patientId, hospital.id);

  const scans = await listScansForPatient(patientId);
  const summaries: ScanSummary[] = scans.map(serializeScan);
  res.json({ scans: summaries });
});

export const getScanHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { scanId } = scanIdParamSchema.parse(req.params);
  const scan = await requireScanForHospital(scanId, hospital.id);
  const job = await findLatestJobForScan(scanId);

  res.json({
    scan: serializeScan(scan),
    job: job
      ? {
          id: job.id,
          status: job.status,
          progress: job.progress,
          currentStep: job.currentStep,
          error: job.error,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        }
      : null,
  });
});

export const processScanHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { scanId } = scanIdParamSchema.parse(req.params);
  await requireScanForHospital(scanId, hospital.id);

  const result = await startScanProcessing({
    scanId,
    userId: auth.userId,
    hospitalId: hospital.id,
  });

  res.status(202).json(result);
});

export const getScanAnalysisHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { scanId } = scanIdParamSchema.parse(req.params);
  await requireScanForHospital(scanId, hospital.id);

  const job = await findLatestJobForScan(scanId);
  if (!job) {
    throw AppError.notFound('Analysis is not available for this scan yet.');
  }

  const result = await findAnalysisResult(job.id);
  if (!result) {
    throw AppError.notFound('Analysis is not available for this scan yet.');
  }

  res.json({
    jobId: job.id,
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

export const listScanImagesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { scanId } = scanIdParamSchema.parse(req.params);
  await requireScanForHospital(scanId, hospital.id);

  const images = await listScanImages(scanId);
  res.json({ images: await signedImageItems(images) });
});

export const listScanModelsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { scanId } = scanIdParamSchema.parse(req.params);
  await requireScanForHospital(scanId, hospital.id);

  const models = await listScanModels(scanId);
  res.json({ models: await signedModelItems(models) });
});

export const uploadScanImagesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { scanId } = scanIdParamSchema.parse(req.params);
  const scan = await requireScanForHospital(scanId, hospital.id);

  const uploadableStatuses = new Set(['CREATED', 'UPLOADING', 'UPLOADED', 'FAILED']);
  if (!uploadableStatuses.has(scan.status)) {
    throw AppError.conflict('Cannot upload images while this scan is processing or completed.');
  }

  const rawFiles = req.files;
  if (!Array.isArray(rawFiles)) {
    throw AppError.badRequest('At least one image file is required in the "images" field.');
  }
  const files = validateScanUploadedImages(rawFiles, scan.type);
  const angles = parseUploadAngles(req.body?.angles, files.length);

  await updateScanStatus(scanId, { status: 'UPLOADING', error: null });

  const removedImages = await clearScanImagesForReupload(scanId);
  if (removedImages.length > 0) {
    const pathsByBucket = new Map<string, string[]>();
    for (const image of removedImages) {
      const bucketPaths = pathsByBucket.get(image.bucket) ?? [];
      bucketPaths.push(image.storagePath);
      pathsByBucket.set(image.bucket, bucketPaths);
    }
    for (const [bucket, paths] of pathsByBucket) {
      await deleteObjects(bucket, paths);
    }
  }

  const bucket = env.SUPABASE_BUCKET_PATIENT_IMAGES;
  const imageRows = [];

  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!;
      const extension = file.originalname.includes('.')
        ? file.originalname.split('.').pop() ?? 'jpg'
        : 'jpg';
      const fileName = `${String(index).padStart(3, '0')}.${extension}`;
      const storagePath = scanImagePath(scan.patientId, scanId, fileName);

      await uploadObject(bucket, storagePath, file.buffer, file.mimetype);

      imageRows.push({
        scanId,
        patientId: scan.patientId,
        bucket,
        storagePath,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        originalName: file.originalname,
        angle: angles[index] ?? null,
        orderIndex: index,
      });
    }

    await createScanImages(imageRows);
    await updateScanStatus(scanId, { status: 'UPLOADED', error: null });
  } catch (error) {
    await updateScanStatus(scanId, {
      status: 'FAILED',
      error: toErrorMessage(error),
    });
    throw error;
  }

  res.status(201).json({
    scanId,
    status: 'UPLOADED',
    imageCount: imageRows.length,
  });
});

export const uploadScanModelHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { scanId } = scanIdParamSchema.parse(req.params);
  const scan = await requireScanForHospital(scanId, hospital.id);

  const uploadableStatuses = new Set(['CREATED', 'UPLOADING', 'UPLOADED', 'FAILED']);
  if (!uploadableStatuses.has(scan.status)) {
    throw AppError.conflict('Cannot upload a model while this scan is processing or completed.');
  }

  const file = validateUploadedModel(req);
  const fileName = file.originalname.toLowerCase().endsWith('.glb')
    ? file.originalname
    : `${file.originalname.replace(/\.[^.]+$/, '') || 'model'}.glb`;
  const bucket = env.SUPABASE_BUCKET_MODELS;
  const storagePath = scanModelPath(scan.patientId, scanId, fileName);

  await uploadObject(bucket, storagePath, file.buffer, file.mimetype || 'model/gltf-binary');

  const model = await createPatientModel({
    patientId: scan.patientId,
    scanId,
    bucket,
    storagePath,
    format: 'GLB',
    mimeType: file.mimetype || 'model/gltf-binary',
    sizeBytes: file.buffer.length,
    fileName,
  });

  res.status(201).json({
    model: {
      ...(await signedModelItems([model]))[0]!,
    },
  });
});

export const listPatientAssetImagesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);
  await requirePatientForHospital(patientId, hospital.id);

  const images = await listPatientImagesForPatient(patientId);
  res.json({ images: await signedImageItems(images) });
});

export const listPatientAssetModelsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);
  await requirePatientForHospital(patientId, hospital.id);

  const models = await listPatientModelsForPatient(patientId);
  res.json({ models: await signedModelItems(models) });
});
