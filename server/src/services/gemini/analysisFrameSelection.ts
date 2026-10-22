import type { ScanType } from '@prisma/client';
import type { PatientImageInput } from './analysis.service';

/** Max frames sent to Gemini for timed bursts (full 80 is costly and may exceed practical limits). */
export const TIMED_BURST_GEMINI_ANALYSIS_FRAMES = 24;

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
  const frameLabel = image.angle ?? String(sourceIndex);
  const approxMs = Number(frameLabel) * 100;
  const timeSuffix = Number.isFinite(approxMs) ? `, ~${approxMs}ms` : '';
  return `Patient video frame ${subsetIndex + 1}/${subsetLength} (capture ${sourceIndex + 1}/${totalFrames}${timeSuffix})`;
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
