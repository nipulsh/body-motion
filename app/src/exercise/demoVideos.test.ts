import { describe, expect, it } from 'vitest';
import {
  demoVideoStatusOnError,
  demoVideoStatusOnLoad,
  demoVideoStatusOnUrlChange,
  initialDemoVideoStatus,
  isWebmDemoVideo,
  normalizeExerciseVideoUrl,
  resolveExerciseDemoVideoUrl,
} from './demoVideos';

describe('resolveExerciseDemoVideoUrl', () => {
  const manifest = {
    videos: {
      shoulder_abduction: 'shoulder-abduction.webm',
      squat: '/exercise-videos/squat.webm',
    },
  };

  it('prefers API-provided demoVideoUrl', () => {
    expect(
      resolveExerciseDemoVideoUrl(
        'shoulder_abduction',
        'https://cdn.example.com/demo.webm',
        manifest,
      ),
    ).toBe('https://cdn.example.com/demo.webm');
  });

  it('falls back to manifest entry keyed by exercise id', () => {
    expect(resolveExerciseDemoVideoUrl('shoulder_abduction', null, manifest)).toBe(
      '/exercise-videos/shoulder-abduction.webm',
    );
  });

  it('returns null when no video is configured', () => {
    expect(resolveExerciseDemoVideoUrl('unknown_exercise', null, manifest)).toBeNull();
  });

  it('normalizes relative manifest paths to public exercise-videos URLs', () => {
    expect(normalizeExerciseVideoUrl('knee-extension.webm')).toBe(
      '/exercise-videos/knee-extension.webm',
    );
    expect(normalizeExerciseVideoUrl('/exercise-videos/squat.webm')).toBe(
      '/exercise-videos/squat.webm',
    );
  });
});

describe('demo video format helpers', () => {
  it('detects webm sources for alpha-friendly styling', () => {
    expect(isWebmDemoVideo('/exercise-videos/shoulder-abduction.webm')).toBe(true);
    expect(isWebmDemoVideo('/exercise-videos/demo.mp4')).toBe(false);
  });
});

describe('demo video status', () => {
  it('starts in loading when a url exists', () => {
    expect(initialDemoVideoStatus('/exercise-videos/squat.webm')).toBe('loading');
  });

  it('starts missing without a url', () => {
    expect(initialDemoVideoStatus(null)).toBe('missing');
  });

  it('resets to loading when exercise video changes', () => {
    expect(demoVideoStatusOnUrlChange('/exercise-videos/a.webm')).toBe('loading');
    expect(demoVideoStatusOnUrlChange(undefined)).toBe('missing');
  });

  it('marks ready after load unless already errored', () => {
    expect(demoVideoStatusOnLoad('loading')).toBe('ready');
    expect(demoVideoStatusOnLoad('error')).toBe('error');
  });

  it('marks error on playback failure', () => {
    expect(demoVideoStatusOnError()).toBe('error');
  });
});

describe('exercise switching mapping', () => {
  it('maps different exercise ids to different videos', () => {
    const manifest = {
      videos: {
        exercise_a: 'a.webm',
        exercise_b: 'b.webm',
      },
    };
    expect(resolveExerciseDemoVideoUrl('exercise_a', null, manifest)).toBe(
      '/exercise-videos/a.webm',
    );
    expect(resolveExerciseDemoVideoUrl('exercise_b', null, manifest)).toBe(
      '/exercise-videos/b.webm',
    );
  });
});

describe('video looping contract', () => {
  it('uses public URLs suitable for looped inline playback', () => {
    const url = resolveExerciseDemoVideoUrl('squat', null, {
      videos: { squat: 'squat.webm' },
    });
    expect(url).toMatch(/^\/exercise-videos\/.+\.webm$/);
  });
});
