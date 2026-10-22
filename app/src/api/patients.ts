import { apiFetch } from './client';
import type {
  CreatePatientInput,
  CreatePatientResponse,
  GetPatientResponse,
  ListPatientsResponse,
  PatientDetail,
  UpdatePatientInput,
  UpdatePatientResponse,
} from './types';

export async function createPatient(input: CreatePatientInput): Promise<CreatePatientResponse> {
  return apiFetch<CreatePatientResponse>('/api/patients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getPatients(query?: string): Promise<ListPatientsResponse> {
  const params = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  return apiFetch<ListPatientsResponse>(`/api/patients${params}`);
}

export async function getPatient(patientId: string): Promise<GetPatientResponse> {
  return apiFetch<GetPatientResponse>(`/api/patients/${patientId}`);
}

export async function updatePatient(
  patientId: string,
  input: UpdatePatientInput,
): Promise<UpdatePatientResponse> {
  return apiFetch<UpdatePatientResponse>(`/api/patients/${patientId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deletePatient(patientId: string): Promise<void> {
  await apiFetch<void>(`/api/patients/${patientId}`, { method: 'DELETE' });
}

export function patientDisplayName(patient: Pick<PatientDetail, 'firstName' | 'lastName' | 'fullName'>): string {
  return patient.fullName || `${patient.firstName} ${patient.lastName}`.trim();
}

export function patientAgeLabel(dateOfBirth: string | null): string {
  if (!dateOfBirth) return '—';
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime())) return '—';
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return String(age);
}

export function formatGender(gender: string | null): string {
  if (!gender) return '—';
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}
