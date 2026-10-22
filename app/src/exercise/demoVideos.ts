import manifest from '../../public/exercise-videos/manifest.json';

export interface ExerciseVideoManifest {
  version?: number;
  description?: string;
  referenceImage?: string;
  videos: Record<string, string>;
}

const catalog = manifest as ExerciseVideoManifest;

/** Preferred transparent demo format for Chromium / Electron webview. */
export const PREFERRED_DEMO_VIDEO_FORMAT = 'video/webm; codecs="vp9"';

/**
 * Resolve a public URL for an exercise demo video.
 * Priority: API-provided URL → manifest entry keyed by stable exercise id.
 */
export function resolveExerciseDemoVideoUrl(
  exerciseId: string,
  apiDemoVideoUrl?: string | null,
  videoManifest: ExerciseVideoManifest = catalog,
): string | null {
  const trimmedApiUrl = apiDemoVideoUrl?.trim();
  if (trimmedApiUrl) {
    return normalizeExerciseVideoUrl(trimmedApiUrl);
  }

  const manifestEntry = videoManifest.videos[exerciseId]?.trim();
  if (!manifestEntry) {
    return null;
  }

  return normalizeExerciseVideoUrl(manifestEntry);
}

export function normalizeExerciseVideoUrl(pathOrUrl: string): string {
  const value = pathOrUrl.trim();
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
    return value;
  }
  return `/exercise-videos/${value.replace(/^\/+/, '')}`;
}

export function isWebmDemoVideo(url: string): boolean {
  const normalized = url.split('?')[0]?.toLowerCase() ?? '';
  return normalized.endsWith('.webm');
}

export type ExerciseDemoVideoStatus = 'missing' | 'loading' | 'ready' | 'error';

export function initialDemoVideoStatus(videoUrl?: string | null): ExerciseDemoVideoStatus {
  return videoUrl ? 'loading' : 'missing';
}

export function demoVideoStatusOnLoad(current: ExerciseDemoVideoStatus): ExerciseDemoVideoStatus {
  return current === 'error' ? 'error' : 'ready';
}

export function demoVideoStatusOnError(): ExerciseDemoVideoStatus {
  return 'error';
}

export function demoVideoStatusOnUrlChange(videoUrl?: string | null): ExerciseDemoVideoStatus {
  return initialDemoVideoStatus(videoUrl);
}
