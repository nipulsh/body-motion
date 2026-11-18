import type { AnalysisResponse, JobStatusResponse, PatientSummary } from '../api/types';
import type { ExerciseSessionStats } from '../exercise/sessionState';
import type { Exercise, PoseResult, ScanCaptureMode } from '@vision';

export type WorkflowStage =
  | 'welcome'
  | 'mirror_home'
  | 'mirror_analysis'
  | 'mirror_uploading'
  | 'mirror_processing'
  | 'mirror_results'
  /** The bundled sample analysis (`DEMO_ANALYSIS`); leaves the patient's own result alone. */
  | 'mirror_demo_results'
  | 'mirror_exercise_plan'
  | 'mirror_exercise_session'
  | 'games_placeholder'
  | 'balance_bird_game'
  | 'bowling_game'
  | 'rehab_games'
  | 'dashboard'
  | 'patients'
  | 'add_patient'
  | 'patient_detail'
  | 'scan_detail'
  | 'camera_setup'
  | 'scanning'
  | 'uploading'
  | 'processing'
  | 'results'
  | 'exercise_loading'
  | 'exercise_plan'
  | 'exercise_session'
  | 'exercise_complete'
  | 'error';

export interface CapturedImage {
  blob: Blob;
  angleDeg: number;
  timestamp: number;
  /** Pose on this frame, used for the objective posture measurements sent with the scan. */
  pose?: PoseResult;
}

/** `job` posts /api/jobs/:id/retry. `recapture` returns to retryStage and does not resume the stored job. */
export type WorkflowRetryKind = 'job' | 'recapture';

export interface WorkflowError {
  title: string;
  message: string;
  technical?: string;
  retryStage?: WorkflowStage;
  retryKind?: WorkflowRetryKind;
}

export interface WorkflowState {
  stage: WorkflowStage;
  patientId: string | null;
  patientName: string | null;
  activePatient: PatientSummary | null;
  scanId: string | null;
  jobId: string | null;
  cameraDeviceId: string | null;
  scanCaptureMode: ScanCaptureMode;
  capturedImages: CapturedImage[];
  captureProgress: { current: number; target: number };
  rotationProgress: number;
  uploadProgress: number;
  jobStatus: JobStatusResponse | null;
  analysis: AnalysisResponse | null;
  riggedGlbUrl: string | null;
  selectedMuscleIndex: number | null;
  exercises: Exercise[] | null;
  exerciseIndex: number;
  exerciseReturnStage: WorkflowStage;
  jobCompleteStage: WorkflowStage;
  exerciseSessionStats: ExerciseSessionStats | null;
  error: WorkflowError | null;
}

export type WorkflowAction =
  | { type: 'SET_STAGE'; stage: WorkflowStage }
  | { type: 'SET_PATIENT'; patientId: string; name: string; patient?: PatientSummary | null }
  | { type: 'SET_ACTIVE_PATIENT'; patient: PatientSummary | null }
  | { type: 'SET_SCAN'; scanId: string | null }
  | { type: 'SET_JOB'; jobId: string }
  | { type: 'SET_CAMERA_DEVICE'; deviceId: string | null }
  | { type: 'SET_SCAN_CAPTURE_MODE'; mode: ScanCaptureMode }
  | { type: 'ADD_CAPTURE'; image: CapturedImage }
  | { type: 'RESET_CAPTURES' }
  | { type: 'SET_CAPTURE_PROGRESS'; current: number; target: number }
  | { type: 'SET_ROTATION_PROGRESS'; degrees: number }
  | { type: 'SET_UPLOAD_PROGRESS'; percent: number }
  | { type: 'SET_JOB_STATUS'; status: JobStatusResponse }
  | { type: 'SET_ANALYSIS'; analysis: AnalysisResponse }
  | { type: 'SET_RIGGED_URL'; url: string | null }
  | { type: 'SET_SELECTED_MUSCLE'; index: number | null }
  | { type: 'SET_EXERCISES'; exercises: Exercise[] }
  | { type: 'SET_EXERCISE_INDEX'; index: number }
  | { type: 'SET_EXERCISE_RETURN_STAGE'; stage: WorkflowStage }
  | { type: 'SET_JOB_COMPLETE_STAGE'; stage: WorkflowStage }
  | { type: 'SET_EXERCISE_SESSION_STATS'; stats: ExerciseSessionStats }
  | { type: 'CLEAR_EXERCISE_SESSION_STATS' }
  | { type: 'CLEAR_EXERCISES' }
  | { type: 'SET_ERROR'; error: WorkflowError | null }
  | { type: 'CLEAR_JOB' }
  | { type: 'LOAD_HISTORY_JOB'; patientId: string; patientName: string; jobId: string }
  | { type: 'RESET_WORKFLOW' };

export const INITIAL_WORKFLOW_STATE: WorkflowState = {
  stage: 'mirror_home',
  patientId: null,
  patientName: null,
  activePatient: null,
  scanId: null,
  jobId: null,
  cameraDeviceId: null,
  scanCaptureMode: 'TIMED_BURST',
  capturedImages: [],
  captureProgress: { current: 0, target: 36 },
  rotationProgress: 0,
  uploadProgress: 0,
  jobStatus: null,
  analysis: null,
  riggedGlbUrl: null,
  selectedMuscleIndex: null,
  exercises: null,
  exerciseIndex: 0,
  exerciseReturnStage: 'exercise_plan',
  jobCompleteStage: 'mirror_results',
  exerciseSessionStats: null,
  error: null,
};

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case 'SET_STAGE':
      return { ...state, stage: action.stage, error: action.stage === 'error' ? state.error : null };
    case 'SET_PATIENT':
      return {
        ...state,
        patientId: action.patientId,
        patientName: action.name,
        activePatient: action.patient ?? state.activePatient,
      };
    case 'SET_ACTIVE_PATIENT':
      return {
        ...state,
        activePatient: action.patient,
        patientId: action.patient?.id ?? null,
        patientName: action.patient?.fullName ?? null,
      };
    case 'SET_SCAN':
      return { ...state, scanId: action.scanId };
    case 'SET_JOB':
      return { ...state, jobId: action.jobId, jobStatus: null, analysis: null, riggedGlbUrl: null };
    case 'SET_CAMERA_DEVICE':
      return { ...state, cameraDeviceId: action.deviceId };
    case 'SET_SCAN_CAPTURE_MODE':
      return { ...state, scanCaptureMode: action.mode };
    case 'ADD_CAPTURE':
      return {
        ...state,
        capturedImages: [...state.capturedImages, action.image],
        captureProgress: {
          ...state.captureProgress,
          current: state.capturedImages.length + 1,
        },
      };
    case 'RESET_CAPTURES':
      return {
        ...state,
        capturedImages: [],
        captureProgress: { current: 0, target: state.captureProgress.target },
        rotationProgress: 0,
      };
    case 'SET_CAPTURE_PROGRESS':
      return {
        ...state,
        captureProgress: { current: action.current, target: action.target },
      };
    case 'SET_ROTATION_PROGRESS':
      return { ...state, rotationProgress: action.degrees };
    case 'SET_UPLOAD_PROGRESS':
      return { ...state, uploadProgress: action.percent };
    case 'SET_JOB_STATUS':
      return { ...state, jobStatus: action.status };
    case 'SET_ANALYSIS':
      return {
        ...state,
        analysis: action.analysis,
        selectedMuscleIndex: action.analysis.muscles.length > 0 ? 0 : null,
      };
    case 'SET_RIGGED_URL':
      return { ...state, riggedGlbUrl: action.url };
    case 'SET_SELECTED_MUSCLE':
      return { ...state, selectedMuscleIndex: action.index };
    case 'SET_EXERCISES':
      return { ...state, exercises: action.exercises, exerciseIndex: 0 };
    case 'SET_EXERCISE_INDEX':
      return { ...state, exerciseIndex: action.index };
    case 'SET_EXERCISE_RETURN_STAGE':
      return { ...state, exerciseReturnStage: action.stage };
    case 'SET_JOB_COMPLETE_STAGE':
      return { ...state, jobCompleteStage: action.stage };
    case 'SET_EXERCISE_SESSION_STATS':
      return { ...state, exerciseSessionStats: action.stats };
    case 'CLEAR_EXERCISE_SESSION_STATS':
      return { ...state, exerciseSessionStats: null };
    case 'CLEAR_EXERCISES':
      return { ...state, exercises: null, exerciseIndex: 0, exerciseSessionStats: null };
    case 'SET_ERROR':
      if (action.error) {
        return { ...state, error: action.error, stage: 'error' };
      }
      return { ...state, error: null };
    case 'CLEAR_JOB':
      return { ...state, jobId: null, jobStatus: null };
    case 'LOAD_HISTORY_JOB':
      return {
        ...state,
        patientId: action.patientId,
        patientName: action.patientName,
        jobId: action.jobId,
        stage: 'processing',
        capturedImages: [],
        error: null,
      };
    case 'RESET_WORKFLOW':
      return { ...INITIAL_WORKFLOW_STATE, stage: 'mirror_home' };
    default: {
      const _never: never = action;
      return _never;
    }
  }
}
