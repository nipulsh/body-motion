import {
  DEMO_VIDEO_SPEC,
  EXERCISE_ID_MAX_LENGTH,
  EXERCISE_ID_PATTERN,
  PREFERRED_DEMO_VIDEO_FILENAME,
} from './demoVideoSpec';

export interface DemoVideoProbeInfo {
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  hasAlpha?: boolean;
  fileSizeBytes: number;
}

export type DemoVideoValidationSeverity = 'error' | 'warning';

export interface DemoVideoValidationIssue {
  code: string;
  message: string;
  severity: DemoVideoValidationSeverity;
  exerciseId?: string;
  filename?: string;
}

export interface ExerciseVideoManifestShape {
  videos: Record<string, string>;
}

export function isValidExerciseId(exerciseId: string): boolean {
  return (
    exerciseId.length >= 1 &&
    exerciseId.length <= EXERCISE_ID_MAX_LENGTH &&
    EXERCISE_ID_PATTERN.test(exerciseId)
  );
}

export function isWebmFilename(filename: string): boolean {
  return filename.split('?')[0]?.toLowerCase().endsWith('.webm') ?? false;
}

export function suggestDemoVideoFilename(exerciseId: string): string {
  return PREFERRED_DEMO_VIDEO_FILENAME(exerciseId);
}

export function validateExerciseIdForDemoVideo(exerciseId: string): DemoVideoValidationIssue[] {
  if (isValidExerciseId(exerciseId)) return [];
  return [
    {
      code: 'invalid_exercise_id',
      severity: 'error',
      exerciseId,
      message: `Exercise id "${exerciseId}" must match ${EXERCISE_ID_PATTERN.source} (max ${EXERCISE_ID_MAX_LENGTH} chars).`,
    },
  ];
}

export function validateManifestFilename(
  exerciseId: string,
  filename: string,
): DemoVideoValidationIssue[] {
  const issues: DemoVideoValidationIssue[] = [];

  issues.push(...validateExerciseIdForDemoVideo(exerciseId));

  if (!filename.trim()) {
    issues.push({
      code: 'empty_filename',
      severity: 'error',
      exerciseId,
      filename,
      message: `Manifest entry for "${exerciseId}" must reference a filename.`,
    });
    return issues;
  }

  if (!isWebmFilename(filename)) {
    issues.push({
      code: 'invalid_extension',
      severity: 'error',
      exerciseId,
      filename,
      message: `Demo video "${filename}" must use the .webm extension.`,
    });
  }

  const preferred = suggestDemoVideoFilename(exerciseId);
  if (filename !== preferred && !filename.includes(exerciseId)) {
    issues.push({
      code: 'filename_not_predictable',
      severity: 'warning',
      exerciseId,
      filename,
      message: `Filename "${filename}" does not match recommended "${preferred}". Prefer exercise-id-based names because display names can change.`,
    });
  }

  return issues;
}

export function validateDemoVideoProbe(
  filename: string,
  probe: DemoVideoProbeInfo,
): DemoVideoValidationIssue[] {
  const issues: DemoVideoValidationIssue[] = [];

  if (probe.fileSizeBytes <= 0) {
    issues.push({
      code: 'empty_file',
      severity: 'error',
      filename,
      message: `Video file "${filename}" is empty.`,
    });
    return issues;
  }

  if (probe.fileSizeBytes < DEMO_VIDEO_SPEC.minFileSizeBytes) {
    issues.push({
      code: 'file_too_small',
      severity: 'error',
      filename,
      message: `Video file "${filename}" is smaller than ${DEMO_VIDEO_SPEC.minFileSizeBytes} bytes and may be corrupt.`,
    });
  }

  if (probe.fileSizeBytes > DEMO_VIDEO_SPEC.maxFileSizeBytes) {
    issues.push({
      code: 'file_too_large',
      severity: 'warning',
      filename,
      message: `Video file "${filename}" exceeds ${DEMO_VIDEO_SPEC.maxFileSizeBytes} bytes. Consider re-encoding for faster load times.`,
    });
  }

  if (probe.durationSeconds !== undefined) {
    if (
      probe.durationSeconds < DEMO_VIDEO_SPEC.minDurationSeconds ||
      probe.durationSeconds > DEMO_VIDEO_SPEC.maxDurationSeconds
    ) {
      issues.push({
        code: 'invalid_duration',
        severity: 'error',
        filename,
        message: `Video "${filename}" duration ${probe.durationSeconds.toFixed(2)}s must be between ${DEMO_VIDEO_SPEC.minDurationSeconds}s and ${DEMO_VIDEO_SPEC.maxDurationSeconds}s for seamless looping.`,
      });
    }
  }

  if (probe.width !== undefined && probe.height !== undefined) {
    if (
      probe.width < DEMO_VIDEO_SPEC.minWidth ||
      probe.height < DEMO_VIDEO_SPEC.minHeight
    ) {
      issues.push({
        code: 'resolution_too_low',
        severity: 'error',
        filename,
        message: `Video "${filename}" resolution ${probe.width}x${probe.height} is below minimum ${DEMO_VIDEO_SPEC.minWidth}x${DEMO_VIDEO_SPEC.minHeight}.`,
      });
    }

    if (
      probe.width < DEMO_VIDEO_SPEC.recommendedWidth ||
      probe.height < DEMO_VIDEO_SPEC.recommendedHeight
    ) {
      issues.push({
        code: 'resolution_below_recommended',
        severity: 'warning',
        filename,
        message: `Video "${filename}" resolution ${probe.width}x${probe.height} is below recommended ${DEMO_VIDEO_SPEC.recommendedWidth}x${DEMO_VIDEO_SPEC.recommendedHeight} for smart-mirror display.`,
      });
    }
  }

  if (probe.fps !== undefined) {
    if (probe.fps < DEMO_VIDEO_SPEC.minFps || probe.fps > DEMO_VIDEO_SPEC.maxFps) {
      issues.push({
        code: 'invalid_fps',
        severity: 'warning',
        filename,
        message: `Video "${filename}" fps ${probe.fps.toFixed(2)} should be between ${DEMO_VIDEO_SPEC.minFps} and ${DEMO_VIDEO_SPEC.maxFps}.`,
      });
    }
  }

  if (probe.codec !== undefined) {
    const normalizedCodec = probe.codec.toLowerCase();
    if (!normalizedCodec.includes('vp9') && !normalizedCodec.includes('vp8')) {
      issues.push({
        code: 'unexpected_codec',
        severity: 'warning',
        filename,
        message: `Video "${filename}" codec "${probe.codec}" is not VP9. Preferred codec: ${DEMO_VIDEO_SPEC.codec}.`,
      });
    }
  }

  if (probe.hasAlpha === false) {
    issues.push({
      code: 'alpha_missing',
      severity: 'warning',
      filename,
      message: `Video "${filename}" has no alpha channel. Transparent WebM is preferred; the app will use a fallback panel background.`,
    });
  }

  return issues;
}

export function validateManifestStructure(
  manifest: ExerciseVideoManifestShape,
): DemoVideoValidationIssue[] {
  const issues: DemoVideoValidationIssue[] = [];

  if (!manifest.videos || typeof manifest.videos !== 'object') {
    issues.push({
      code: 'invalid_manifest',
      severity: 'error',
      message: 'manifest.json must contain a "videos" object.',
    });
    return issues;
  }

  const ids = Object.keys(manifest.videos);
  if (new Set(ids).size !== ids.length) {
    issues.push({
      code: 'duplicate_exercise_id',
      severity: 'error',
      message: 'manifest.json contains duplicate exercise ids.',
    });
  }

  for (const [exerciseId, filename] of Object.entries(manifest.videos)) {
    issues.push(...validateManifestFilename(exerciseId, filename));
  }

  return issues;
}

export function summarizeValidationIssues(
  issues: DemoVideoValidationIssue[],
): { errors: DemoVideoValidationIssue[]; warnings: DemoVideoValidationIssue[] } {
  return {
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
  };
}
