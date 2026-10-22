import type { ErrorCode } from '../utils/AppError';

export interface ApiErrorBody {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
  };
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  database: 'ok' | 'error';
  models: {
    analysis: string;
    imageGeneration: string;
  };
}

export interface PatientSummary {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientDetail extends PatientSummary {
  deformities: string | null;
  chronicConditions: string | null;
  notes: string | null;
}

export interface JobAnalysisPreview {
  bodyRegion: string;
  observedDeformation: string;
  summary: string;
}

export interface JobSummary {
  id: string;
  status: string;
  progress: number;
  createdAt: string;
  analysis: JobAnalysisPreview | null;
}

export interface JobStatusResponse {
  jobId: string;
  patientId: string;
  status: string;
  progress: number;
  currentStep: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedImageResponseItem {
  view: 'front' | 'right' | 'back' | 'left';
  url: string;
}

export interface ModelResponse {
  glbUrl: string | null;
  riggedGlbUrl: string | null;
}

export interface PatientImageResponseItem {
  id: string;
  url: string;
  angle: string | null;
  createdAt: string;
}

export interface HospitalSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetMyHospitalResponse {
  hospital: HospitalSummary;
}

export interface ScanSummary {
  id: string;
  patientId: string;
  type: string;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScanResponse {
  scanId: string;
  status: string;
  scan: ScanSummary;
}

export interface PatientAssetImageResponseItem {
  id: string;
  patientId: string;
  scanId: string | null;
  jobId: string | null;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  angle: string | null;
  orderIndex: number;
  createdAt: string;
  url: string;
}

export interface ExerciseTrackingRuleResponse {
  joint: string;
  startAngle: number;
  requiredAngle: number;
  minimumAngle: number;
  maximumAngle: number;
  tolerance: number;
  movement: string;
  startingPosition: string;
  targetPosition: string;
  holdDurationSeconds?: number;
}

export interface ExerciseResponseItem {
  id: string;
  name: string;
  description: string;
  targetBodyParts: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sets: number;
  recommendedReps: number;
  restSeconds: number;
  instructions: string[];
  safetyNotes: string[];
  trackingRules: ExerciseTrackingRuleResponse[];
}

export interface GenerateExercisesResponse {
  jobId: string;
  modelName: string;
  exercises: ExerciseResponseItem[];
}

export interface ExerciseDemoVideoResponse {
  exerciseId: string;
  demoVideoUrl: string;
  cached: boolean;
}

export interface PatientAssetModelResponseItem {
  id: string;
  patientId: string;
  scanId: string | null;
  format: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string | null;
  createdAt: string;
  url: string;
}
