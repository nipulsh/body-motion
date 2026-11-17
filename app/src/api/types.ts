export interface ApiErrorBody {
  error: {
    code: string;
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

export interface CreatePatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  gender?: 'male' | 'female' | 'other' | 'unknown' | null;
  phone?: string;
  email?: string | null;
  deformities?: string;
  chronicConditions?: string;
  notes?: string;
}

export type UpdatePatientInput = Partial<CreatePatientInput>;

export interface CreatePatientResponse {
  patient: PatientSummary;
}

export interface UpdatePatientResponse {
  patient: PatientDetail;
}

export interface ListPatientsResponse {
  patients: PatientSummary[];
}

export interface GetPatientResponse {
  patient: PatientDetail;
  jobs: JobSummary[];
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

export type MuscleSide = 'left' | 'right' | 'bilateral' | 'midline' | 'unknown';

export interface AnalysisMuscle {
  name: string;
  side: MuscleSide;
  likelihood: number;
  deformation: string;
  intensity: number;
  reason: string;
  /** Share (0–100) of the observed posture deformity attributed to this muscle; all muscles sum to 100. */
  contributionPercent?: number;
  bodyExplorerId?: string;
  bodyExplorerMeshNames?: string[];
}

export interface AnalysisDeformity {
  name: string;
  region: string;
  side: MuscleSide;
  /** 0 = barely present, 1 = pronounced. */
  severity: number;
  description: string;
}

export interface AnalysisResponse {
  bodyRegion: string;
  observedDeformation: string;
  affectedSide: MuscleSide;
  summary: string;
  /** False when clothing, framing or image quality stopped the analysis; `summary` says why. */
  analysisPossible?: boolean;
  /** Every deformity found, most pronounced first. */
  deformities?: AnalysisDeformity[];
  muscles: AnalysisMuscle[];
  /** Clinician-only: the AI kept ignoring a measured deviation. Never show on patient screens. */
  measurementConflict?: string;
}

export interface GeneratedImageResponseItem {
  view: 'front' | 'right' | 'back' | 'left';
  url: string;
}

export interface ModelResponse {
  glbUrl: string | null;
  riggedGlbUrl: string | null;
}

export interface CreateJobResponse {
  jobId: string;
  status: 'QUEUED';
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
  demoVideoUrl?: string | null;
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

export interface ListPatientScansResponse {
  scans: ScanSummary[];
}

export interface PatientAssetImage {
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

export interface PatientAssetModel {
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

export interface ListPatientAssetImagesResponse {
  images: PatientAssetImage[];
}

export interface ListPatientAssetModelsResponse {
  models: PatientAssetModel[];
}

export interface ListScanImagesResponse {
  images: PatientAssetImage[];
}

export interface ListScanModelsResponse {
  models: PatientAssetModel[];
}

export interface UploadScanImagesResponse {
  scanId: string;
  status: string;
  imageCount: number;
}

export interface ScanJobSummary {
  id: string;
  status: string;
  progress: number;
  currentStep: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetScanDetailResponse {
  scan: ScanSummary;
  job: ScanJobSummary | null;
}

export interface ProcessScanResponse {
  jobId: string;
  scanId: string;
  status: string;
}
