/** Patient-centric storage layout (Step 5+). */
export function scanImagePath(patientId: string, scanId: string, fileName: string): string {
  return `patients/${patientId}/scans/${scanId}/images/${fileName}`;
}

export function scanModelPath(patientId: string, scanId: string, fileName: string): string {
  return `patients/${patientId}/scans/${scanId}/models/${fileName}`;
}

export function patientStoragePrefix(patientId: string): string {
  return `patients/${patientId}`;
}

/** Legacy analysis-job layout kept for existing pipeline compatibility. */
export function patientImagePath(
  userId: string,
  patientId: string,
  jobId: string,
  fileName: string,
): string {
  return `${userId}/${patientId}/${jobId}/${fileName}`;
}

export function generatedImagePath(
  userId: string,
  patientId: string,
  jobId: string,
  view: string,
  extension: string,
): string {
  return `${userId}/${patientId}/${jobId}/${view.toLowerCase()}.${extension}`;
}

export function modelPath(
  userId: string,
  patientId: string,
  jobId: string,
  fileName: string,
): string {
  return `${userId}/${patientId}/${jobId}/${fileName}`;
}
