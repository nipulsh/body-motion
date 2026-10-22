import { describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '@vision';
import type { ExerciseFrameDiagnostics } from '@vision';
import { CalibrationRecorder } from './calibrationRecorder';
import { resolveCameraPositioningFeedback } from './cameraPositioning';
import { isExerciseDiagnosticEnabled, isProductionPatientMode } from './diagnosticMode';
import { formatDiagnosticOverlay } from './ExerciseDiagnosticOverlay';

const sampleDiagnostics: ExerciseFrameDiagnostics = {
  fps: 15,
  cameraWidth: 1280,
  cameraHeight: 720,
  poseConfidence: 0.94,
  bodyVisibilityScore: 0.88,
  bodyFullyVisible: true,
  jointAngles: {
    right_shoulder: { available: true, angle: 87, confidence: 0.94 },
  },
  targets: {
    right_shoulder: { start: 20, required: 90, tolerance: 12 },
  },
  phase: 'HOLDING',
  repCount: 4,
  targetReps: 10,
  trackingEnabled: true,
  feedback: 'Hold',
};

describe('diagnosticMode', () => {
  it('disables diagnostics in production builds', () => {
    expect(isProductionPatientMode()).toBe(false);
    expect(isExerciseDiagnosticEnabled()).toBe(false);
  });
});

describe('calibration recorder', () => {
  it('records angle and phase samples without video', () => {
    const recorder = new CalibrationRecorder();
    recorder.record(sampleDiagnostics, 1000);
    expect(recorder.count).toBe(1);
    const line = recorder.exportJsonl();
    const parsed = JSON.parse(line) as { phase: string; repCount: number };
    expect(parsed.phase).toBe('HOLDING');
    expect(parsed.repCount).toBe(4);
    expect(line.includes('video')).toBe(false);
  });
});

describe('diagnostic overlay formatting', () => {
  it('includes fps, angles, phase, and rep count', () => {
    const lines = formatDiagnosticOverlay(sampleDiagnostics);
    expect(lines.some((line) => line.startsWith('FPS:'))).toBe(true);
    expect(lines.some((line) => line.includes('Right Shoulder: 87.0°'))).toBe(true);
    expect(lines.some((line) => line.includes('Phase: HOLDING'))).toBe(true);
    expect(lines.some((line) => line.includes('Rep: 4 / 10'))).toBe(true);
  });
});

describe('camera positioning feedback', () => {
  it('prompts the patient to step back when pose is missing', () => {
    expect(resolveCameraPositioningFeedback(null)).toBe(
      'Step back until your entire body is visible.',
    );
  });
});

describe('calibration config', () => {
  it('uses widened start tolerance for real-world framing variance', () => {
    expect(VISION_CONFIG.repDetection.startToleranceFactor).toBeGreaterThan(1);
  });

  it('allows slightly larger angle jumps for fast shoulder raises', () => {
    expect(VISION_CONFIG.jointAngles.maxAngleJumpDeg).toBeGreaterThanOrEqual(50);
  });
});
