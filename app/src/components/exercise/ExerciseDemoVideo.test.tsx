/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExerciseDemoVideo } from './ExerciseDemoVideo';

describe('ExerciseDemoVideo', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows fallback when videoUrl is missing', () => {
    act(() => {
      root.render(<ExerciseDemoVideo exerciseName="Shoulder Abduction" />);
    });

    expect(container.textContent).toContain('Shoulder Abduction');
    expect(container.textContent).toContain('Demo video coming soon');
    expect(container.querySelector('video')).toBeNull();
  });

  it('renders a looped inline video when url is available', () => {
    act(() => {
      root.render(
        <ExerciseDemoVideo
          exerciseName="Shoulder Abduction"
          videoUrl="/exercise-videos/shoulder-abduction.webm"
        />,
      );
    });

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/exercise-videos/shoulder-abduction.webm');
    expect(video?.loop).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.controls).toBe(false);
    expect(video?.getAttribute('aria-label')).toBe('Demonstration video for Shoulder Abduction');
  });

  it('shows loading state before the video is ready', () => {
    act(() => {
      root.render(
        <ExerciseDemoVideo
          exerciseName="Knee Extension"
          videoUrl="/exercise-videos/knee-extension.webm"
        />,
      );
    });

    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows error fallback when playback fails', () => {
    act(() => {
      root.render(
        <ExerciseDemoVideo
          exerciseName="Squat"
          videoUrl="/exercise-videos/missing.webm"
        />,
      );
    });

    const video = container.querySelector('video');
    expect(video).not.toBeNull();

    act(() => {
      video?.dispatchEvent(new Event('error'));
    });

    expect(container.textContent).toContain('Demo video unavailable');
    expect(container.querySelector('video')).toBeNull();
  });

  it('remounts video when switching exercises', () => {
    act(() => {
      root.render(
        <ExerciseDemoVideo
          exerciseName="Exercise A"
          videoUrl="/exercise-videos/a.webm"
        />,
      );
    });
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/exercise-videos/a.webm');

    act(() => {
      root.render(
        <ExerciseDemoVideo
          exerciseName="Exercise B"
          videoUrl="/exercise-videos/b.webm"
        />,
      );
    });
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/exercise-videos/b.webm');
  });
});
