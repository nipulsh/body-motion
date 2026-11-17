import { Prisma, type PatientImage, type PatientModel, type Scan, type ScanStatus, type ScanType } from '@prisma/client';
import { prisma } from './prisma';

export async function createScan(input: {
  patientId: string;
  type?: ScanType;
}): Promise<Scan> {
  return prisma.scan.create({
    data: {
      patientId: input.patientId,
      type: input.type ?? 'BODY_360',
      status: 'CREATED',
    },
  });
}

export async function findScanById(scanId: string): Promise<Scan | null> {
  return prisma.scan.findUnique({ where: { id: scanId } });
}

export async function listScansForPatient(patientId: string): Promise<Scan[]> {
  return prisma.scan.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateScanPostureMetrics(
  scanId: string,
  postureMetrics: Prisma.InputJsonValue | null,
): Promise<void> {
  await prisma.scan.update({
    where: { id: scanId },
    data: { postureMetrics: postureMetrics ?? Prisma.DbNull },
  });
}

export async function updateScanStatus(
  scanId: string,
  data: {
    status: ScanStatus;
    error?: string | null;
  },
): Promise<Scan> {
  return prisma.scan.update({
    where: { id: scanId },
    data: {
      status: data.status,
      error: data.error ?? null,
    },
  });
}

export async function createScanImages(
  rows: Prisma.PatientImageCreateManyInput[],
): Promise<void> {
  await prisma.patientImage.createMany({ data: rows });
}

export async function clearScanImagesForReupload(scanId: string): Promise<PatientImage[]> {
  const existing = await listScanImages(scanId);
  if (existing.length === 0) return existing;
  await prisma.patientImage.deleteMany({ where: { scanId } });
  return existing;
}

export async function listScanImages(scanId: string): Promise<PatientImage[]> {
  return prisma.patientImage.findMany({
    where: { scanId },
    orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function listPatientImagesForPatient(patientId: string): Promise<PatientImage[]> {
  return prisma.patientImage.findMany({
    where: { patientId },
    orderBy: [{ createdAt: 'desc' }, { orderIndex: 'asc' }],
  });
}

export async function createPatientModel(
  input: Prisma.PatientModelUncheckedCreateInput,
): Promise<PatientModel> {
  return prisma.patientModel.create({ data: input });
}

export async function listScanModels(scanId: string): Promise<PatientModel[]> {
  return prisma.patientModel.findMany({
    where: { scanId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listPatientModelsForPatient(patientId: string): Promise<PatientModel[]> {
  return prisma.patientModel.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function linkScanImagesToJob(scanId: string, jobId: string): Promise<number> {
  const result = await prisma.patientImage.updateMany({
    where: { scanId, jobId: null },
    data: { jobId },
  });
  return result.count;
}

export async function upsertScanPatientModel(input: {
  patientId: string;
  scanId: string;
  bucket: string;
  storagePath: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}): Promise<PatientModel> {
  const existing = await prisma.patientModel.findFirst({
    where: {
      scanId: input.scanId,
      fileName: input.fileName,
    },
  });

  if (existing) {
    return prisma.patientModel.update({
      where: { id: existing.id },
      data: {
        bucket: input.bucket,
        storagePath: input.storagePath,
        mimeType: input.mimeType ?? 'model/gltf-binary',
        sizeBytes: input.sizeBytes ?? existing.sizeBytes,
      },
    });
  }

  return prisma.patientModel.create({
    data: {
      patientId: input.patientId,
      scanId: input.scanId,
      bucket: input.bucket,
      storagePath: input.storagePath,
      format: 'GLB',
      mimeType: input.mimeType ?? 'model/gltf-binary',
      sizeBytes: input.sizeBytes ?? 0,
      fileName: input.fileName,
    },
  });
}

export function serializeScan(scan: Scan) {
  return {
    id: scan.id,
    patientId: scan.patientId,
    type: scan.type,
    status: scan.status,
    error: scan.error,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString(),
  };
}

export function serializePatientImage(image: PatientImage) {
  return {
    id: image.id,
    patientId: image.patientId,
    scanId: image.scanId,
    jobId: image.jobId,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    originalName: image.originalName,
    angle: image.angle,
    orderIndex: image.orderIndex,
    createdAt: image.createdAt.toISOString(),
  };
}

export function serializePatientModel(model: PatientModel) {
  return {
    id: model.id,
    patientId: model.patientId,
    scanId: model.scanId,
    format: model.format,
    mimeType: model.mimeType,
    sizeBytes: model.sizeBytes,
    fileName: model.fileName,
    createdAt: model.createdAt.toISOString(),
  };
}
