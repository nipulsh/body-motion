import type { Request, Response } from 'express';
import { env } from '../config/env';
import { createJob, createPatientImages } from '../repositories/job.repository';
import {
  countHospitalLinks,
  createPatientForHospital,
  deletePatientRecord,
  findPatientForHospital,
  findPatientWithJobsForHospital,
  listJobUserIdsForPatient,
  listPatientsForHospital,
  unlinkPatientFromHospital,
  updatePatientForHospital,
} from '../repositories/patient.repository';
import { patientIdParamSchema } from '../schemas/common.schema';
import {
  createPatientBodySchema,
  listPatientsQuerySchema,
  normalizeCreatePatientBody,
  normalizeUpdatePatientBody,
  updatePatientBodySchema,
} from '../schemas/patient.schema';
import { enqueueAnalysisJob } from '../services/jobs/jobRunner';
import { patientImagePath } from '../services/storage/paths';
import { deletePatientStorage, uploadObject } from '../services/storage/storage.service';
import type { JobSummary, PatientSummary } from '../types/api';
import { AppError, toErrorMessage } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { jobUploadError, jobUploadLog, patientsLog } from '../utils/jobUploadLog';
import { logger } from '../utils/logger';
import { serializePatientDetail, serializePatientSummary } from '../utils/patientSerializer';
import { prismaErrorLogFields } from '../utils/prismaError';
import { requireHospitalForUser } from '../utils/requireHospital';
import { parseUploadAngles } from '../utils/uploadAngles';
import { validateUploadedImages } from '../middleware/upload.middleware';

export const createPatientHandler = asyncHandler(async (req: Request, res: Response) => {
  patientsLog('request received', { method: req.method, requestId: req.requestId });
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const body = createPatientBodySchema.parse(req.body);

  patientsLog('database query started', { operation: 'createPatient', hospitalId: hospital.id });
  let patient;
  try {
    patient = await createPatientForHospital(hospital.id, normalizeCreatePatientBody(body));
  } catch (error) {
    logger.error('[ERROR]', {
      stage: 'CREATE_PATIENT',
      status: 503,
      hospitalId: hospital.id,
      ...prismaErrorLogFields(error),
    });
    throw error;
  }
  patientsLog('database query completed', { patientId: patient.id });

  res.status(201).json({
    patient: serializePatientSummary(patient),
  });
});

export const listPatientsHandler = asyncHandler(async (req: Request, res: Response) => {
  patientsLog('request received', { method: req.method, requestId: req.requestId });
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { q } = listPatientsQuerySchema.parse(req.query);

  patientsLog('database query started', { operation: 'listPatients', hospitalId: hospital.id });
  let patients;
  try {
    patients = await listPatientsForHospital(hospital.id, q);
  } catch (error) {
    logger.error('[ERROR]', {
      stage: 'LIST_PATIENTS',
      status: 503,
      hospitalId: hospital.id,
      ...prismaErrorLogFields(error),
    });
    throw error;
  }
  patientsLog('database query completed', { count: patients.length });

  const summaries: PatientSummary[] = patients.map(serializePatientSummary);
  res.json({ patients: summaries });
});

export const getPatientHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);
  const patient = await findPatientWithJobsForHospital(patientId, hospital.id);
  if (!patient) throw AppError.notFound('Patient not found.');

  const jobs: JobSummary[] = patient.jobs.map((job) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt.toISOString(),
    analysis: job.analysisResult
      ? {
          bodyRegion: job.analysisResult.bodyRegion,
          observedDeformation: job.analysisResult.observedDeformation,
          summary: job.analysisResult.summary,
        }
      : null,
  }));

  res.json({
    patient: serializePatientDetail(patient),
    jobs,
  });
});

export const updatePatientHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);
  const body = updatePatientBodySchema.parse(req.body);

  let patient;
  try {
    patient = await updatePatientForHospital(
      patientId,
      hospital.id,
      normalizeUpdatePatientBody(body),
    );
  } catch (error) {
    logger.error('[ERROR]', {
      stage: 'UPDATE_PATIENT',
      status: 503,
      patientId,
      hospitalId: hospital.id,
      ...prismaErrorLogFields(error),
    });
    throw error;
  }

  if (!patient) throw AppError.notFound('Patient not found.');

  res.json({ patient: serializePatientDetail(patient) });
});

export const deletePatientHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);

  const patient = await findPatientForHospital(patientId, hospital.id);
  if (!patient) throw AppError.notFound('Patient not found.');

  const removed = await unlinkPatientFromHospital(patientId, hospital.id);
  if (!removed) throw AppError.notFound('Patient not found.');

  const remainingLinks = await countHospitalLinks(patientId);
  if (remainingLinks === 0) {
    const legacyUserIds = await listJobUserIdsForPatient(patientId);
    await deletePatientStorage(patientId, legacyUserIds);
    await deletePatientRecord(patientId);
  }

  res.status(204).send();
});

export const createJobHandler = asyncHandler(async (req: Request, res: Response) => {
  jobUploadLog('request received', { requestId: req.requestId });

  const auth = req.auth;
  if (!auth) {
    jobUploadError('AUTH', { status: 401, message: 'Missing auth context.' });
    throw AppError.unauthorized();
  }
  jobUploadLog('authenticated', { authenticated: true });

  const hospital = await requireHospitalForUser(auth.userId);
  const { patientId } = patientIdParamSchema.parse(req.params);
  jobUploadLog('patientId', { patientId });

  let patient;
  try {
    patient = await findPatientForHospital(patientId, hospital.id);
  } catch (error) {
    jobUploadError('DATABASE', { status: 503, ...prismaErrorLogFields(error) });
    throw error;
  }
  if (!patient) {
    jobUploadError('DATABASE', { status: 404, message: 'Patient not found.', patientId });
    throw AppError.notFound('Patient not found.');
  }

  const files = validateUploadedImages(req);
  const totalBytes = files.reduce((sum, file) => sum + file.buffer.length, 0);
  jobUploadLog('fileCount', { fileCount: files.length, totalBytes });

  const angles = parseUploadAngles(req.body?.angles, files.length);

  let job;
  try {
    job = await createJob({ patientId, userId: auth.userId });
  } catch (error) {
    jobUploadError('DATABASE', { status: 503, ...prismaErrorLogFields(error) });
    throw error;
  }
  jobUploadLog('database job created', { jobId: job.id });
  jobUploadLog('job created', { jobId: job.id });

  const imageRows = [];
  jobUploadLog('supabase upload started', { jobId: job.id, fileCount: files.length });
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!;
      const extension = file.originalname.includes('.')
        ? file.originalname.split('.').pop() ?? 'jpg'
        : 'jpg';
      const fileName = `${String(index).padStart(3, '0')}.${extension}`;
      const bucket = env.SUPABASE_BUCKET_PATIENT_IMAGES;
      const storagePath = patientImagePath(auth.userId, patientId, job.id, fileName);

      await uploadObject(bucket, storagePath, file.buffer, file.mimetype);

      imageRows.push({
        jobId: job.id,
        patientId,
        bucket,
        storagePath,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        originalName: file.originalname,
        angle: angles[index] ?? null,
        orderIndex: index,
      });
    }
  } catch (error) {
    jobUploadError('SUPABASE_STORAGE', {
      status: error instanceof AppError ? error.statusCode : 502,
      message: toErrorMessage(error),
      jobId: job.id,
    });
    throw error;
  }
  jobUploadLog('supabase upload completed', { jobId: job.id });

  try {
    await createPatientImages(imageRows);
  } catch (error) {
    jobUploadError('DATABASE', { status: 503, ...prismaErrorLogFields(error), jobId: job.id });
    throw error;
  }
  enqueueAnalysisJob(job.id);
  jobUploadLog('pipeline started', { jobId: job.id });

  res.status(202).json({
    jobId: job.id,
    status: 'QUEUED',
  });
});
