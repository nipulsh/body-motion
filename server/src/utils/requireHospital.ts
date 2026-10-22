import { findHospitalForUser } from '../repositories/hospital.repository';
import { AppError } from './AppError';

export async function requireHospitalForUser(userId: string) {
  const hospital = await findHospitalForUser(userId);
  if (!hospital) {
    throw AppError.forbidden('Hospital profile is required before managing patients.');
  }
  return hospital;
}
