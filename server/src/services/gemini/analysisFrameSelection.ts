import type { ScanType } from '@prisma/client';
import type { PatientImageInput } from './analysis.service';

/** Max frames sent to Gemini for timed bursts. The guided capture is 30 (10 front, 10 right, 10 back), all sent. */
export const TIMED_BURST_GEMINI_ANALYSIS_FRAMES = 30;

type AnalysisFrame = {
  buffer: Buffer;
  mimeType: string;
  angle?: string | null;
  orderIndex: number;
};

function pickEvenlySpacedIndices(length: number, count: number): number[] {
  if (length <= 0 || count <= 0) return [];
  if (length <= count) {
    return Array.from({ length }, (_, i) => i);
  }
  const picks: number[] = [];
  for (let i = 0; i < count; i += 1) {
    picks.push(Math.round((i * (length - 1)) / Math.max(count - 1, 1)));
  }
  return [...new Set(picks)].slice(0, count);
}

/** Frame positions to download. Timed bursts keep 24 evenly spaced frames; other scans keep every frame. */
export function selectGeminiAnalysisFrameIndexes(scanType: ScanType, frameCount: number): number[] {
  if (frameCount <= 0) return [];
  if (scanType !== 'TIMED_BURST') {
    return Array.from({ length: frameCount }, (_, index) => index);
  }
  return pickEvenlySpacedIndices(frameCount, TIMED_BURST_GEMINI_ANALYSIS_FRAMES);
}

function timedBurstFrameLabel(
  image: { angle?: string | null },
  subsetIndex: number,
  subsetLength: number,
  sourceIndex: number,
  totalFrames: number,
): string {
  const angle = Number(image.angle);
  // Guided capture stores 0 for facing the camera, 90 for turned right, 180 for the back to the camera.
  // 270 (turned left) comes from scans taken before the back view replaced it.
  const view =
    angle === 0
      ? ', facing the camera'
      : angle === 90
        ? ', turned right'
        : angle === 180
          ? ', back to the camera'
          : angle === 270
            ? ', turned left'
            : '';
  return `Patient frame ${subsetIndex + 1}/${subsetLength} (capture ${sourceIndex + 1}/${totalFrames}${view})`;
}

function buildTimedBurstInputs(
  selected: Array<{ buffer: Buffer; mimeType: string; angle?: string | null }>,
  indexes: number[],
  totalFrames: number,
): PatientImageInput[] {
  return selected.map((image, subsetIndex) => ({
    buffer: image.buffer,
    mimeType: image.mimeType,
    label: timedBurstFrameLabel(
      image,
      subsetIndex,
      selected.length,
      indexes[subsetIndex] ?? subsetIndex,
      totalFrames,
    ),
  }));
}

export function buildGeminiAnalysisInputs(
  scanType: ScanType,
  images: AnalysisFrame[],
  selection?: { totalFrames: number; indexes: number[] },
): PatientImageInput[] {
  if (scanType !== 'TIMED_BURST') {
    return images.map((image, index) => ({
      buffer: image.buffer,
      mimeType: image.mimeType,
      label: `Patient image ${index + 1}${image.angle ? ` (${image.angle})` : ''}`,
    }));
  }

  if (selection) {
    return buildTimedBurstInputs(images, selection.indexes, selection.totalFrames);
  }

  const indexes = selectGeminiAnalysisFrameIndexes(scanType, images.length);
  const selected = indexes.map((sourceIndex) => images[sourceIndex]!);
  return buildTimedBurstInputs(selected, indexes, images.length);
}
