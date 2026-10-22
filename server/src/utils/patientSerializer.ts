import type { Patient } from '@prisma/client';
import type { PatientDetail, PatientSummary } from '../types/api';

export function patientFullName(patient: Pick<Patient, 'firstName' | 'lastName'>): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

export function serializePatientSummary(patient: Patient): PatientSummary {
  return {
    id: patient.id,
    firstName: patient.firstName,
    lastName: patient.lastName,
    fullName: patientFullName(patient),
    dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    gender: patient.gender,
    phone: patient.phone,
    email: patient.email,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
  };
}

export function serializePatientDetail(patient: Patient): PatientDetail {
  return {
    ...serializePatientSummary(patient),
    deformities: patient.deformities,
    chronicConditions: patient.chronicConditions,
    notes: patient.notes,
  };
}
