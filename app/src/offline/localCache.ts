import type { HospitalSummary, PatientDetail, PatientSummary, ScanSummary } from '../api/types';
import type { Exercise } from '@vision';

const CACHE_PREFIX = 'bodyexplorer:v1';

function storageKey(userId: string, suffix: string): string {
  return `${CACHE_PREFIX}:${userId}:${suffix}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[cache] Failed to write local cache:', error);
  }
}

export interface CachedPatientBundle {
  patient: PatientDetail;
  scans: ScanSummary[];
  cachedAt: string;
}

interface CachedPatientList {
  patients: PatientSummary[];
  cachedAt: string;
}

export function saveHospital(userId: string, hospital: HospitalSummary): void {
  writeJson(storageKey(userId, 'hospital'), hospital);
}

export function loadHospital(userId: string): HospitalSummary | null {
  return readJson<HospitalSummary>(storageKey(userId, 'hospital'));
}

export function savePatientList(userId: string, patients: PatientSummary[]): void {
  const payload: CachedPatientList = {
    patients,
    cachedAt: new Date().toISOString(),
  };
  writeJson(storageKey(userId, 'patients'), payload);
}

export function loadPatientList(userId: string): PatientSummary[] | null {
  const payload = readJson<CachedPatientList>(storageKey(userId, 'patients'));
  return payload?.patients ?? null;
}

export function savePatientBundle(
  userId: string,
  patientId: string,
  bundle: Omit<CachedPatientBundle, 'cachedAt'>,
): void {
  const payload: CachedPatientBundle = {
    ...bundle,
    cachedAt: new Date().toISOString(),
  };
  writeJson(storageKey(userId, `patient:${patientId}`), payload);
}

export function loadPatientBundle(userId: string, patientId: string): CachedPatientBundle | null {
  return readJson<CachedPatientBundle>(storageKey(userId, `patient:${patientId}`));
}

export function saveExercisePlan(jobId: string, exercises: Exercise[]): void {
  writeJson(storageKey('shared', `exercises:${jobId}`), exercises);
}

export function loadExercisePlan(jobId: string): Exercise[] | null {
  const exercises = readJson<Exercise[]>(storageKey('shared', `exercises:${jobId}`));
  if (!exercises || exercises.length === 0) return null;
  return exercises;
}

export function findCachedScan(
  userId: string,
  patientId: string,
  scanId: string,
): ScanSummary | null {
  const bundle = loadPatientBundle(userId, patientId);
  return bundle?.scans.find((scan) => scan.id === scanId) ?? null;
}

export function filterPatientSummaries(
  patients: PatientSummary[],
  query: string,
): PatientSummary[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return patients;

  return patients.filter((patient) => {
    const haystack = [
      patient.fullName,
      patient.firstName,
      patient.lastName,
      patient.phone ?? '',
      patient.id,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}
