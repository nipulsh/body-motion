import { describe, expect, it } from 'vitest';
import { DEMO_VIDEO_SPEC } from './demoVideoSpec';
import {
  isValidExerciseId,
  suggestDemoVideoFilename,
  summarizeValidationIssues,
  validateDemoVideoProbe,
  validateExerciseIdForDemoVideo,
  validateManifestFilename,
  validateManifestStructure,
} from './demoVideoValidation';

describe('exercise id stability', () => {
  it('accepts Gemini-style stable ids', () => {
    expect(isValidExerciseId('shoulder_abduction_001')).toBe(true);
    expect(isValidExerciseId('shoulder_flexion_march')).toBe(true);
  });

  it('rejects display-name style ids', () => {
    expect(isValidExerciseId('Shoulder Abduction')).toBe(false);
    expect(isValidExerciseId('')).toBe(false);
  });
});

describe('manifest filename conventions', () => {
  it('recommends exercise-id.webm filenames', () => {
    expect(suggestDemoVideoFilename('shoulder_abduction_001')).toBe(
      'shoulder_abduction_001.webm',
    );
  });

  it('requires webm extension', () => {
    const issues = validateManifestFilename('shoulder_abduction_001', 'shoulder.mp4');
    expect(issues.some((issue) => issue.code === 'invalid_extension')).toBe(true);
  });

  it('warns when filename is not id-based', () => {
    const issues = validateManifestFilename('shoulder_abduction_001', 'demo.webm');
    expect(issues.some((issue) => issue.code === 'filename_not_predictable')).toBe(true);
  });
});

describe('demo video probe validation', () => {
  it('accepts a valid webm probe', () => {
    const issues = validateDemoVideoProbe('shoulder_abduction_001.webm', {
      fileSizeBytes: 500_000,
      durationSeconds: 7,
      width: 1080,
      height: 1920,
      fps: 30,
      codec: 'vp9',
      hasAlpha: true,
    });
    expect(summarizeValidationIssues(issues).errors).toHaveLength(0);
  });

  it('flags empty or corrupt files', () => {
    const issues = validateDemoVideoProbe('bad.webm', { fileSizeBytes: 0 });
    expect(issues.some((issue) => issue.code === 'empty_file')).toBe(true);
  });

  it('flags invalid duration', () => {
    const issues = validateDemoVideoProbe('long.webm', {
      fileSizeBytes: 100_000,
      durationSeconds: 15,
    });
    expect(issues.some((issue) => issue.code === 'invalid_duration')).toBe(true);
  });

  it('warns when alpha is unavailable without failing validation', () => {
    const issues = validateDemoVideoProbe('opaque.webm', {
      fileSizeBytes: 100_000,
      durationSeconds: 6,
      width: 1080,
      height: 1920,
      hasAlpha: false,
    });
    expect(issues.some((issue) => issue.code === 'alpha_missing')).toBe(true);
    expect(issues.every((issue) => issue.severity !== 'error')).toBe(true);
  });
});

describe('manifest structure', () => {
  it('validates unique exercise ids in manifest entries', () => {
    const issues = validateManifestStructure({
      videos: {
        shoulder_abduction_001: 'shoulder_abduction_001.webm',
        knee_extension_001: 'knee_extension_001.webm',
      },
    });
    expect(summarizeValidationIssues(issues).errors).toHaveLength(0);
  });

  it('rejects invalid exercise ids', () => {
    const issues = validateExerciseIdForDemoVideo('Shoulder Abduction');
    expect(issues).toHaveLength(1);
  });
});

describe('technical specification constants', () => {
  it('targets loopable webm vp9 without audio', () => {
    expect(DEMO_VIDEO_SPEC.format).toBe('webm');
    expect(DEMO_VIDEO_SPEC.codec).toBe('vp9');
    expect(DEMO_VIDEO_SPEC.audioAllowed).toBe(false);
    expect(DEMO_VIDEO_SPEC.loopable).toBe(true);
  });
});
