import { summarizePosture, type PoseResult } from '@vision';
import type { AnalysisResponse } from './types';
import { apiFetch, apiUploadWithProgress } from './client';
import type {
  CreateScanResponse,
  GetScanDetailResponse,
  ListPatientAssetImagesResponse,
  ListPatientAssetModelsResponse,
  ListPatientScansResponse,
  ListScanImagesResponse,
  ListScanModelsResponse,
  UploadScanImagesResponse,
} from './types';

function extensionForType(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function toUploadFile(blob: Blob, index: number): File {
  const type = blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const name = `capture_${String(index).padStart(3, '0')}.${extensionForType(type)}`;
  if (blob instanceof File) {
    return blob;
  }
  return new File([blob], name, { type });
}

export type ScanApiType = 'BODY_360' | 'TIMED_BURST';

export async function createScan(
  patientId: string,
  type: ScanApiType = 'BODY_360',
): Promise<CreateScanResponse> {
  return apiFetch<CreateScanResponse>(`/api/patients/${patientId}/scans`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

export async function getPatientScans(patientId: string): Promise<ListPatientScansResponse> {
  return apiFetch<ListPatientScansResponse>(`/api/patients/${patientId}/scans`);
}

export async function getPatientImages(patientId: string): Promise<ListPatientAssetImagesResponse> {
  return apiFetch<ListPatientAssetImagesResponse>(`/api/patients/${patientId}/images`);
}

export async function getPatientModels(patientId: string): Promise<ListPatientAssetModelsResponse> {
  return apiFetch<ListPatientAssetModelsResponse>(`/api/patients/${patientId}/models`);
}

export async function getScan(scanId: string): Promise<GetScanDetailResponse> {
  return apiFetch<GetScanDetailResponse>(`/api/scans/${scanId}`);
}

export async function getScanAnalysis(scanId: string): Promise<AnalysisResponse & { jobId: string }> {
  return apiFetch<AnalysisResponse & { jobId: string }>(`/api/scans/${scanId}/analysis`);
}

export async function processScan(
  scanId: string,
): Promise<{ jobId: string; scanId: string; status: string }> {
  return apiFetch<{ jobId: string; scanId: string; status: string }>(`/api/scans/${scanId}/process`, {
    method: 'POST',
  });
}

export async function retryScanProcessing(
  scanId: string,
): Promise<{ jobId: string; scanId: string; status: string }> {
  return processScan(scanId);
}

export async function getScanImages(scanId: string): Promise<ListScanImagesResponse> {
  return apiFetch<ListScanImagesResponse>(`/api/scans/${scanId}/images`);
}

export async function getScanModels(scanId: string): Promise<ListScanModelsResponse> {
  return apiFetch<ListScanModelsResponse>(`/api/scans/${scanId}/models`);
}

export async function uploadScanImages(
  scanId: string,
  images: Array<Blob | { blob: Blob; angleDeg?: number; pose?: PoseResult }>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadScanImagesResponse> {
  if (images.length === 0) {
    throw new Error('No images to upload.');
  }

  const normalized = images.map((entry) =>
    entry instanceof Blob
      ? { blob: entry, angleDeg: undefined as number | undefined, pose: undefined as PoseResult | undefined }
      : entry,
  );

  const formData = new FormData();
  const angles: string[] = [];
  normalized.forEach((entry, index) => {
    if (entry.blob.size <= 0) {
      throw new Error(`Image ${index} is empty.`);
    }
    formData.append('images', toUploadFile(entry.blob, index));
    angles.push(
      entry.angleDeg != null && Number.isFinite(entry.angleDeg)
        ? String(Math.round(entry.angleDeg))
        : '',
    );
  });
  formData.append('angles', JSON.stringify(angles));
  // Objective, camera-tilt-independent posture measurements so the analysis can name the
  // body part that actually deviates instead of guessing from pixels alone.
  const posture = summarizePosture(normalized.map((entry) => entry.pose));
  if (posture) formData.append('postureMetrics', JSON.stringify(posture));

  const text = await apiUploadWithProgress(
    `/api/scans/${scanId}/images`,
    formData,
    onProgress,
  );
  return JSON.parse(text) as UploadScanImagesResponse;
}

export function formatScanStatus(status: string): string {
  switch (status) {
    case 'CREATED':
      return 'Created';
    case 'UPLOADING':
      return 'Uploading';
    case 'UPLOADED':
      return 'Ready to process';
    case 'PROCESSING':
      return 'Processing';
    case 'ANALYZING':
      return 'Analyzing';
    case 'GENERATING_MODEL':
      return 'Generating 3D model';
    case 'COMPLETED':
      return 'Completed';
    case 'FAILED':
      return 'Failed';
    default:
      return status;
  }
}
