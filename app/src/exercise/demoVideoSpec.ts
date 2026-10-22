/**
 * Technical requirements for AI-generated exercise demonstration videos.
 * Keep in sync with docs/exercise-videos/SPECIFICATION.md.
 */
export const DEMO_VIDEO_SPEC = {
  format: 'webm',
  codec: 'vp9',
  alphaPreferred: true,
  minDurationSeconds: 5,
  maxDurationSeconds: 10,
  minFps: 24,
  maxFps: 30,
  minWidth: 480,
  minHeight: 640,
  recommendedWidth: 1080,
  recommendedHeight: 1920,
  minFileSizeBytes: 10_000,
  maxFileSizeBytes: 50_000_000,
  audioAllowed: false,
  loopable: true,
} as const;

/** Gemini exercise ids: lowercase alphanumeric with underscores or hyphens. */
export const EXERCISE_ID_PATTERN = /^[a-z0-9_-]+$/;

export const EXERCISE_ID_MAX_LENGTH = 64;

export const DEMO_VIDEO_ASSET_DIR = 'public/exercise-videos';

export const DEMO_VIDEO_REFERENCE_IMAGE_PATH =
  'public/exercise-videos/reference/body-motion-model-front.png';

export const PREFERRED_DEMO_VIDEO_FILENAME = (exerciseId: string): string =>
  `${exerciseId}.webm`;
