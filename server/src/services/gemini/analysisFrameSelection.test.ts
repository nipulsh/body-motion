import { describe, expect, it } from 'vitest';
import {
  buildGeminiAnalysisInputs,
  selectGeminiAnalysisFrameIndexes,
  TIMED_BURST_GEMINI_ANALYSIS_FRAMES,
} from './analysisFrameSelection';

describe('buildGeminiAnalysisInputs', () => {
  it('subsamples timed burst frames for Gemini', () => {
    const images = Array.from({ length: 80 }, (_, orderIndex) => ({
      buffer: Buffer.from(`frame-${orderIndex}`),
      mimeType: 'image/jpeg',
      angle: String(orderIndex),
      orderIndex,
    }));

    const inputs = buildGeminiAnalysisInputs('TIMED_BURST', images);
    expect(inputs.length).toBe(TIMED_BURST_GEMINI_ANALYSIS_FRAMES);
    expect(inputs[0]?.label).toContain('Patient frame');
  });

  it('passes through all body 360 images', () => {
    const images = Array.from({ length: 36 }, (_, orderIndex) => ({
      buffer: Buffer.from(`angle-${orderIndex}`),
      mimeType: 'image/jpeg',
      angle: String(orderIndex * 10),
      orderIndex,
    }));

    const inputs = buildGeminiAnalysisInputs('BODY_360', images);
    expect(inputs.length).toBe(36);
  });

  it('selects 24 timed-burst indexes before the frames are downloaded', () => {
    const images = Array.from({ length: 80 }, (_, orderIndex) => ({
      buffer: Buffer.from(`frame-${orderIndex}`),
      mimeType: 'image/jpeg',
      angle: String(orderIndex),
      orderIndex,
    }));

    const indexes = selectGeminiAnalysisFrameIndexes('TIMED_BURST', images.length);
    expect(indexes).toHaveLength(TIMED_BURST_GEMINI_ANALYSIS_FRAMES);
    expect(indexes[0]).toBe(0);
    expect(indexes[indexes.length - 1]).toBe(79);

    const selected = indexes.map((index) => images[index]!);
    const fromSelection = buildGeminiAnalysisInputs('TIMED_BURST', selected, {
      totalFrames: images.length,
      indexes,
    });
    expect(fromSelection).toEqual(buildGeminiAnalysisInputs('TIMED_BURST', images));
  });

  it('keeps every frame when the timed burst is already at or under the limit', () => {
    expect(selectGeminiAnalysisFrameIndexes('TIMED_BURST', 10)).toEqual(
      Array.from({ length: 10 }, (_, index) => index),
    );
  });

  it('selects every body 360 frame', () => {
    expect(selectGeminiAnalysisFrameIndexes('BODY_360', 36)).toEqual(
      Array.from({ length: 36 }, (_, index) => index),
    );
    expect(selectGeminiAnalysisFrameIndexes('BODY_360', 0)).toEqual([]);
  });
});
