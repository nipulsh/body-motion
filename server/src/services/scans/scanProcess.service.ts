import type { JobStatus, PipelineStep, ScanStatus } from '@prisma/client';

import { imageLimitsForScanType } from '../../config/scanImageLimits';

import { prisma } from '../../repositories/prisma';

import {

  listScanImages,

  updateScanStatus,

} from '../../repositories/scan.repository';

import { enqueueAnalysisJob } from '../jobs/jobRunner';

import { AppError } from '../../utils/AppError';

import { requireScanForHospital } from '../../utils/patientAccess';



const PROCESSABLE_SCAN_STATUSES: ScanStatus[] = ['UPLOADED', 'FAILED'];

const ACTIVE_JOB_STATUSES: JobStatus[] = [

  'QUEUED',

  'ANALYZING',

  'GENERATING_IMAGES',

  'CREATING_3D_MODEL',

  'RIGGING',

];



export function mapJobStatusToScanStatus(status: JobStatus, step?: PipelineStep | null): ScanStatus {

  if (status === 'FAILED') return 'FAILED';

  if (status === 'COMPLETED') return 'COMPLETED';



  if (status === 'CREATING_3D_MODEL' || status === 'RIGGING') {

    return 'GENERATING_MODEL';

  }



  if (status === 'ANALYZING' || status === 'GENERATING_IMAGES') {

    return 'ANALYZING';

  }



  if (step === 'MODEL_GENERATION' || step === 'RIGGING') {

    return 'GENERATING_MODEL';

  }



  if (step === 'ANALYSIS' || step === 'IMAGE_GENERATION') {

    return 'ANALYZING';

  }



  return 'PROCESSING';

}



export async function syncScanStatusForJob(

  scanId: string,

  data: {

    status: JobStatus;

    failedStep?: PipelineStep | null;

    error?: string | null;

  },

): Promise<void> {

  await updateScanStatus(scanId, {

    status: mapJobStatusToScanStatus(data.status, data.failedStep ?? null),

    error: data.error ?? null,

  });

}



export async function startScanProcessing(input: {

  scanId: string;

  userId: string;

  hospitalId: string;

}): Promise<{ jobId: string; scanId: string; status: 'QUEUED' }> {

  const scan = await requireScanForHospital(input.scanId, input.hospitalId);



  if (!PROCESSABLE_SCAN_STATUSES.includes(scan.status)) {

    const active = await prisma.analysisJob.findFirst({

      where: {

        scanId: scan.id,

        status: { in: ACTIVE_JOB_STATUSES },

      },

    });

    if (active) {

      throw AppError.conflict('This scan is already being processed.');

    }

    throw AppError.conflict('This scan is not ready to process.');

  }



  const images = await listScanImages(scan.id);

  const { min: minImages, max: maxImages } = imageLimitsForScanType(scan.type);

  if (images.length < minImages || images.length > maxImages) {

    throw AppError.badRequest(

      `This scan requires ${minImages}-${maxImages} images before processing (found ${images.length}).`,

    );

  }



  const result = await prisma.$transaction(async (tx) => {

    const lockedScan = await tx.scan.findFirst({

      where: {

        id: scan.id,

        status: { in: PROCESSABLE_SCAN_STATUSES },

        patient: {

          hospitalLinks: { some: { hospitalId: input.hospitalId } },

        },

      },

    });



    if (!lockedScan) {

      throw AppError.conflict('This scan is not ready to process.');

    }



    const activeJob = await tx.analysisJob.findFirst({

      where: {

        scanId: scan.id,

        status: { in: ACTIVE_JOB_STATUSES },

      },

    });

    if (activeJob) {

      throw AppError.conflict('This scan is already being processed.');

    }



    const latestJob = await tx.analysisJob.findFirst({

      where: { scanId: scan.id },

      orderBy: { createdAt: 'desc' },

    });



    if (latestJob?.status === 'FAILED') {

      await tx.analysisJob.update({

        where: { id: latestJob.id },

        data: {

          status: 'QUEUED',

          error: null,

          failedStep: null,

          currentStep: null,

          progress: 0,

        },

      });

      await tx.patientImage.updateMany({

        where: { scanId: scan.id, jobId: null },

        data: { jobId: latestJob.id },

      });

      await tx.scan.update({

        where: { id: scan.id },

        data: { status: 'PROCESSING', error: null },

      });

      return { jobId: latestJob.id, scanId: scan.id, status: 'QUEUED' as const };

    }



    const job = await tx.analysisJob.create({

      data: {

        patientId: scan.patientId,

        userId: input.userId,

        scanId: scan.id,

        status: 'QUEUED',

        progress: 0,

      },

    });



    await tx.patientImage.updateMany({

      where: { scanId: scan.id, jobId: null },

      data: { jobId: job.id },

    });



    await tx.scan.update({

      where: { id: scan.id },

      data: { status: 'PROCESSING', error: null },

    });



    return { jobId: job.id, scanId: scan.id, status: 'QUEUED' as const };

  });



  enqueueAnalysisJob(result.jobId);

  return result;

}


