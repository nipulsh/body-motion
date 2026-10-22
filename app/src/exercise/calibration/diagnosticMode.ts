import { VISION_CONFIG } from '@vision';

/** Production patient mode hides all developer calibration tooling. */
export function isProductionPatientMode(): boolean {
  return import.meta.env.PROD === true;
}

/** Dev-only exercise diagnostic overlay (FPS, angles, phase). */
export function isExerciseDiagnosticEnabled(): boolean {
  if (isProductionPatientMode()) return false;
  return VISION_CONFIG.debug.exerciseDiagnostic;
}

export function isExerciseCalibrationAvailable(): boolean {
  return isExerciseDiagnosticEnabled();
}
