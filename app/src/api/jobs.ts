import { apiFetch, apiUploadWithProgress } from './client';
import type {
  AnalysisResponse,
  CreateJobResponse,
  GeneratedImageResponseItem,
  HealthResponse,
  JobStatusResponse,
  ModelResponse,
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

export async function createAnalysisJob(
  patientId: string,
  images: Array<Blob | { blob: Blob; angleDeg?: number }>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CreateJobResponse> {
  if (images.length === 0) {
    throw new Error('No images to upload.');
  }

  const normalized = images.map((entry) =>
    entry instanceof Blob ? { blob: entry, angleDeg: undefined as number | undefined } : entry,
  );

  const first = normalized[0]?.blob;
  const last = normalized[normalized.length - 1]?.blob;
  const totalBytes = normalized.reduce((sum, image) => sum + image.blob.size, 0);
  console.log('[UPLOAD] patientId:', patientId);
  console.log('[UPLOAD] imageCount:', normalized.length);
  console.log('[UPLOAD] totalBytes:', totalBytes);
  console.log('[UPLOAD] firstImageType:', first?.type);
  console.log('[UPLOAD] firstImageSize:', first?.size);
  console.log(
    '[UPLOAD] last',
    last?.constructor?.name,
    last?.size,
    last?.type,
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

  for (const [key, value] of formData.entries()) {
    if (value instanceof Blob) {
      console.log('[UPLOAD] formData', key, value.constructor.name, value.size, value.type);
    } else {
      console.log('[UPLOAD] formData', key, typeof value);
    }
  }

  const text = await apiUploadWithProgress(
    `/api/patients/${patientId}/jobs`,
    formData,
    onProgress,
  );
  return JSON.parse(text) as CreateJobResponse;
}

export async function getJob(jobId: string): Promise<JobStatusResponse> {
  return apiFetch<JobStatusResponse>(`/api/jobs/${jobId}`);
}

export async function getAnalysis(jobId: string): Promise<AnalysisResponse> {
  return apiFetch<AnalysisResponse>(`/api/jobs/${jobId}/analysis`);
}

export async function getGeneratedImages(
  jobId: string,
): Promise<{ images: GeneratedImageResponseItem[] }> {
  return apiFetch<{ images: GeneratedImageResponseItem[] }>(
    `/api/jobs/${jobId}/generated-images`,
  );
}

export async function getModel(jobId: string): Promise<ModelResponse> {
  return apiFetch<ModelResponse>(`/api/jobs/${jobId}/model`);
}

export async function retryJob(jobId: string): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
}

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/api/health');
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await getHealth();
    return res.status === 'ok' && res.database === 'ok';
  } catch {
    return false;
  }
}
