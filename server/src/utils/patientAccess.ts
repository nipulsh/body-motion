import type { Patient, Scan } from '@prisma/client';
import { findPatientForHospital } from '../repositories/patient.repository';
import { findScanById } from '../repositories/scan.repository';
import { AppError } from './AppError';

export async function requirePatientForHospital(
  patientId: string,
  hospitalId: string,
): Promise<Patient> {
  const patient = await findPatientForHospital(patientId, hospitalId);
  if (!patient) {
    throw AppError.notFound('Patient not found.');
  }
  return patient;
}

export async function requireScanForHospital(
  scanId: string,
  hospitalId: string,
): Promise<Scan & { patientId: string }> {
  const scan = await findScanById(scanId);
  if (!scan) {
    throw AppError.notFound('Scan not found.');
  }

  const patient = await findPatientForHospital(scan.patientId, hospitalId);
  if (!patient) {
    throw AppError.notFound('Scan not found.');
  }

  return scan;
}
