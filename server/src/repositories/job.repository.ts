import type {
  AnalysisJob,
  AnalysisResult,
  GeneratedImage,
  JobStatus,
  MeshyJob,
  MeshyTaskKind,
  MeshyTaskStatus,
  MuscleFinding,
  PipelineStep,
  Prisma,
  ScanType,
} from '@prisma/client';
import { prisma } from './prisma';

export type JobWithRelations = AnalysisJob & {
  analysisResult: (AnalysisResult & { muscleFindings: MuscleFinding[] }) | null;
  generatedImages: GeneratedImage[];
  meshyJobs: MeshyJob[];
  scan: { type: ScanType } | null;
};

export async function createJob(input: {
  patientId: string;
  userId: string;
  scanId?: string | null;
}): Promise<AnalysisJob> {
  return prisma.analysisJob.create({
    data: {
      patientId: input.patientId,
      userId: input.userId,
      scanId: input.scanId ?? null,
      status: 'QUEUED',
      progress: 0,
    },
  });
}


export async function findJobForHospital(
  jobId: string,
  hospitalId: string,
): Promise<AnalysisJob | null> {
  return prisma.analysisJob.findFirst({
    where: {
      id: jobId,
      patient: {
        hospitalLinks: { some: { hospitalId } },
      },
    },
  });
}

export async function findJobById(jobId: string): Promise<AnalysisJob | null> {
  return prisma.analysisJob.findUnique({ where: { id: jobId } });
}

export async function findLatestJobForScan(scanId: string): Promise<AnalysisJob | null> {
  return prisma.analysisJob.findFirst({
    where: { scanId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findActiveJobForScan(scanId: string): Promise<AnalysisJob | null> {
  return prisma.analysisJob.findFirst({
    where: {
      scanId,
      status: { notIn: ['COMPLETED', 'FAILED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findJobWithRelations(jobId: string): Promise<JobWithRelations | null> {
  return prisma.analysisJob.findUnique({
    where: { id: jobId },
    include: {
      analysisResult: { include: { muscleFindings: true } },
      generatedImages: true,
      meshyJobs: true,
      scan: { select: { type: true } },
    },
  });
}

export async function updateJobProgress(
  jobId: string,
  data: {
    status?: JobStatus;
    progress?: number;
    currentStep?: string | null;
    error?: string | null;
    failedStep?: PipelineStep | null;
  },
): Promise<void> {
  await prisma.analysisJob.update({ where: { id: jobId }, data });
}

export async function markJobStarted(jobId: string): Promise<void> {
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: { startedAt: new Date(), error: null, failedStep: null },
  });
}

export async function markJobFailed(
  jobId: string,
  failedStep: PipelineStep,
  message: string,
): Promise<void> {
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: { status: 'FAILED', failedStep, error: message, currentStep: null },
  });
}

export async function markJobCompleted(jobId: string): Promise<void> {
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      progress: 100,
      currentStep: null,
      failedStep: null,
      error: null,
      completedAt: new Date(),
    },
  });
}

export async function createPatientImages(
  rows: Prisma.PatientImageCreateManyInput[],
): Promise<void> {
  await prisma.patientImage.createMany({ data: rows });
}

export async function listJobImages(jobId: string) {
  return prisma.patientImage.findMany({ where: { jobId }, orderBy: { orderIndex: 'asc' } });
}

export async function saveAnalysisResult(input: {
  jobId: string;
  bodyRegion: string;
  observedDeformation: string;
  affectedSide: AnalysisResult['affectedSide'];
  summary: string;
  modelName: string;
  parsed: Prisma.InputJsonValue;
  rawResponse: Prisma.InputJsonValue;
  findings: Omit<Prisma.MuscleFindingCreateManyInput, 'analysisResultId' | 'jobId'>[];
}): Promise<AnalysisResult> {
  return prisma.$transaction(async (tx) => {
    await tx.muscleFinding.deleteMany({ where: { jobId: input.jobId } });
    await tx.analysisResult.deleteMany({ where: { jobId: input.jobId } });

    const result = await tx.analysisResult.create({
      data: {
        jobId: input.jobId,
        bodyRegion: input.bodyRegion,
        observedDeformation: input.observedDeformation,
        affectedSide: input.affectedSide,
        summary: input.summary,
        modelName: input.modelName,
        parsed: input.parsed,
        rawResponse: input.rawResponse,
      },
    });

    if (input.findings.length > 0) {
      await tx.muscleFinding.createMany({
        data: input.findings.map((finding) => ({
          ...finding,
          jobId: input.jobId,
          analysisResultId: result.id,
        })),
      });
    }

    return result;
  });
}

export async function findAnalysisResult(
  jobId: string,
): Promise<(AnalysisResult & { muscleFindings: MuscleFinding[] }) | null> {
  return prisma.analysisResult.findUnique({
    where: { jobId },
    include: { muscleFindings: true },
  });
}

export async function upsertGeneratedImage(input: {
  jobId: string;
  view: GeneratedImage['view'];
  bucket: string;
  storagePath: string;
  mimeType: string;
  prompt: string;
  modelName: string;
}): Promise<GeneratedImage> {
  const { jobId, view, ...rest } = input;
  return prisma.generatedImage.upsert({
    where: { jobId_view: { jobId, view } },
    create: { jobId, view, ...rest },
    update: rest,
  });
}

export async function listGeneratedImages(jobId: string): Promise<GeneratedImage[]> {
  return prisma.generatedImage.findMany({ where: { jobId } });
}

export async function upsertMeshyJob(input: {
  jobId: string;
  kind: MeshyTaskKind;
  taskId: string;
  status: MeshyTaskStatus;
  progress?: number;
  modelUrl?: string | null;
  bucket?: string | null;
  storagePath?: string | null;
  error?: string | null;
  raw?: Prisma.InputJsonValue;
}): Promise<MeshyJob> {
  const { jobId, kind, ...rest } = input;
  return prisma.meshyJob.upsert({
    where: { jobId_kind: { jobId, kind } },
    create: { jobId, kind, ...rest },
    update: rest,
  });
}

export async function findMeshyJob(jobId: string, kind: MeshyTaskKind): Promise<MeshyJob | null> {
  return prisma.meshyJob.findUnique({ where: { jobId_kind: { jobId, kind } } });
}

export async function listMeshyJobs(jobId: string): Promise<MeshyJob[]> {
  return prisma.meshyJob.findMany({ where: { jobId } });
}
