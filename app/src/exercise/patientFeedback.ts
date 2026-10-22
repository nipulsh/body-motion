import type { PoseResult, RepDetectionResult, RepPhase } from '@vision';
import { resolveCameraPositioningFeedback } from './calibration/cameraPositioning';

export const PATIENT_ERRORS = {
  camera: 'Camera unavailable. Please check the camera connection.',
  pose: "We can't see your full body. Please step back and try again.",
  demoVideo: 'Demo temporarily unavailable. You can continue the exercise using the instructions.',
  exercisePlan: "We couldn't load your exercise plan. Please try again.",
  vision: 'Pose tracking is temporarily unavailable. Please stay in view of the camera.',
} as const;

const TECHNICAL_TERMS = /mediapipe|jointanglesnapshot|repdetector|trackingrule|snapshot|landmark/gi;

export function sanitizePatientMessage(message: string): string {
  if (TECHNICAL_TERMS.test(message)) {
    return 'Please adjust your position and try again.';
  }
  return message.replace(/\s+/g, ' ').trim();
}

export function formatMirrorFeedback(text: string): string {
  const sanitized = sanitizePatientMessage(text);
  if (!sanitized) return 'GET READY';
  if (sanitized.toLowerCase() === 'good') return 'GOOD';
  if (sanitized.toLowerCase() === 'hold') return 'HOLD';
  return sanitized.toUpperCase();
}

export function mapDetectorFeedbackToPatient(
  feedback: string | undefined,
  phase: RepPhase | null,
): string {
  if (phase === 'REP_COMPLETED') return 'GOOD';
  if (!feedback) return 'GET READY';

  const normalized = feedback.toLowerCase();

  if (normalized === 'good') return 'GOOD';
  if (normalized === 'hold' || normalized === 'hold at target position') return 'HOLD';
  if (normalized === 'move toward target position') return 'MOVE TOWARD TARGET';
  if (normalized === 'return to starting position') return 'RETURN';
  if (normalized === 'exercise complete') return 'EXERCISE COMPLETE';
  if (normalized.includes('visible to the camera')) {
    return 'MAKE SURE YOUR FULL BODY IS VISIBLE';
  }
  if (normalized.includes('return to starting position')) return 'RETURN';
  if (normalized.includes('move toward target')) return 'MOVE TOWARD TARGET';
  if (normalized.includes('move your') && normalized.includes('flexion')) {
    return 'MOVE TOWARD TARGET';
  }
  if (normalized.includes('increase') || normalized.includes('reduce')) {
    return 'MOVE TOWARD TARGET';
  }

  return formatMirrorFeedback(feedback);
}

export function derivePositioningFeedback(
  pose: PoseResult | null,
  repResult: RepDetectionResult | null,
): string | null {
  if (!repResult) return null;

  const cameraFeedback = resolveCameraPositioningFeedback(pose);
  if (cameraFeedback) {
    return cameraFeedback.toUpperCase().includes('STEP BACK')
      ? 'MAKE SURE YOUR FULL BODY IS VISIBLE'
      : 'PLEASE MOVE INTO POSITION';
  }

  if (!pose || !pose.landmarks?.length) {
    return 'MAKE SURE YOUR FULL BODY IS VISIBLE';
  }

  const unavailableRules = Object.values(repResult.rules).filter((rule) => !rule.available);
  if (unavailableRules.length === 0) return null;

  const feedback = repResult.feedback.toLowerCase();
  if (feedback.includes('visible to the camera')) {
    return 'PLEASE MOVE INTO POSITION';
  }

  return 'MAKE SURE YOUR FULL BODY IS VISIBLE';
}

export function resolveLiveFeedback(
  pose: PoseResult | null,
  repResult: RepDetectionResult | null,
  fallback = 'GET READY',
): string {
  const positioning = derivePositioningFeedback(pose, repResult);
  if (positioning) return positioning;
  if (!repResult) return fallback;
  return mapDetectorFeedbackToPatient(repResult.feedback, repResult.phase);
}

export function isPositiveFeedback(displayFeedback: string, repResult: RepDetectionResult | null): boolean {
  if (repResult?.phase === 'REP_COMPLETED') return true;
  if (repResult?.valid === true) return true;
  const normalized = displayFeedback.toUpperCase();
  return normalized === 'GOOD' || normalized === 'HOLD';
}
