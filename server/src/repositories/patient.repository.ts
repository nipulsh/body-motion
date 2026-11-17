import type { Patient, Prisma } from '@prisma/client';
import { prisma } from './prisma';

export interface CreatePatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  deformities: string | null;
  chronicConditions: string | null;
  notes: string | null;
}

function hospitalPatientFilter(hospitalId: string): Prisma.PatientWhereInput {
  return {
    hospitalLinks: {
      some: { hospitalId },
    },
  };
}

function buildSearchFilter(query: string): Prisma.PatientWhereInput {
  const trimmed = query.trim();
  if (!trimmed) return {};

  const parts: Prisma.PatientWhereInput[] = [
    { firstName: { contains: trimmed, mode: 'insensitive' } },
    { lastName: { contains: trimmed, mode: 'insensitive' } },
    { phone: { contains: trimmed, mode: 'insensitive' } },
  ];

  if (trimmed.length >= 8) {
    parts.push({ id: trimmed });
  }

  return { OR: parts };
}

export async function createPatientForHospital(
  hospitalId: string,
  input: CreatePatientInput,
): Promise<Patient> {
  // Single nested write: atomic without an interactive transaction, so slow
  // round trips to the remote DB can't hit Prisma's transaction timeout.
  return prisma.patient.create({
    data: {
      ...input,
      hospitalLinks: { create: { hospitalId } },
    },
  });
}

export async function linkPatientToHospital(
  hospitalId: string,
  patientId: string,
): Promise<void> {
  await prisma.hospitalPatient.upsert({
    where: { hospitalId_patientId: { hospitalId, patientId } },
    create: { hospitalId, patientId },
    update: {},
  });
}

export async function listPatientsForHospital(
  hospitalId: string,
  query?: string,
): Promise<Patient[]> {
  return prisma.patient.findMany({
    where: {
      AND: [hospitalPatientFilter(hospitalId), buildSearchFilter(query ?? '')],
    },
    orderBy: [{ updatedAt: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  });
}

export async function findPatientForHospital(
  patientId: string,
  hospitalId: string,
): Promise<Patient | null> {
  return prisma.patient.findFirst({
    where: {
      id: patientId,
      ...hospitalPatientFilter(hospitalId),
    },
  });
}

export async function findPatientWithJobsForHospital(patientId: string, hospitalId: string) {
  return prisma.patient.findFirst({
    where: {
      id: patientId,
      ...hospitalPatientFilter(hospitalId),
    },
    include: {
      jobs: {
        orderBy: { createdAt: 'desc' },
        include: {
          analysisResult: {
            select: {
              bodyRegion: true,
              observedDeformation: true,
              summary: true,
            },
          },
        },
      },
    },
  });
}

export async function updatePatientForHospital(
  patientId: string,
  hospitalId: string,
  data: Prisma.PatientUpdateInput,
): Promise<Patient | null> {
  const existing = await findPatientForHospital(patientId, hospitalId);
  if (!existing) return null;

  return prisma.patient.update({
    where: { id: patientId },
    data,
  });
}

export async function countHospitalLinks(patientId: string): Promise<number> {
  return prisma.hospitalPatient.count({ where: { patientId } });
}

export async function listJobUserIdsForPatient(patientId: string): Promise<string[]> {
  const rows = await prisma.analysisJob.findMany({
    where: { patientId },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.map((row) => row.userId);
}

export async function unlinkPatientFromHospital(
  patientId: string,
  hospitalId: string,
): Promise<boolean> {
  const result = await prisma.hospitalPatient.deleteMany({
    where: { patientId, hospitalId },
  });
  return result.count > 0;
}

export async function deletePatientRecord(patientId: string): Promise<void> {
  await prisma.patient.delete({ where: { id: patientId } });
}

export async function listPatientImages(patientId: string) {
  return prisma.patientImage.findMany({
    where: { patientId },
    orderBy: [{ createdAt: 'asc' }, { orderIndex: 'asc' }],
  });
}
