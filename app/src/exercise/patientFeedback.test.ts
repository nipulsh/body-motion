import { describe, expect, it } from 'vitest';
import {
  mapDetectorFeedbackToPatient,
  resolveLiveFeedback,
  sanitizePatientMessage,
} from './patientFeedback';

describe('patientFeedback', () => {
  it('maps detector feedback to mirror-friendly uppercase messages', () => {
    expect(mapDetectorFeedbackToPatient('Good', 'READY')).toBe('GOOD');
    expect(mapDetectorFeedbackToPatient('Move toward target position', 'MOVING_TO_TARGET')).toBe(
      'MOVE TOWARD TARGET',
    );
    expect(mapDetectorFeedbackToPatient('Return to starting position', 'RETURNING')).toBe('RETURN');
    expect(mapDetectorFeedbackToPatient(undefined, 'REP_COMPLETED')).toBe('GOOD');
  });

  it('sanitizes technical terms', () => {
    expect(sanitizePatientMessage('RepDetector failed')).toBe(
      'Please adjust your position and try again.',
    );
  });

  it('shows positioning feedback when pose is missing', () => {
    expect(resolveLiveFeedback(null, null)).toBe('GET READY');
    expect(resolveLiveFeedback(null, null, 'GET READY')).toBe('GET READY');
  });
});
