/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXERCISE_LIBRARY } from '../../exercise/library';
import { normalizeExercise } from '../../exercise/normalizeExercise';
import { MirrorExerciseSessionView } from './MirrorExerciseSessionView';

const sampleExercise = normalizeExercise(EXERCISE_LIBRARY[0]!);

vi.mock('../vision/PoseWireframeOverlay', () => ({
  PoseWireframeOverlay: () => <canvas data-testid="mirror-exercise-wireframe" />,
}));

describe('MirrorExerciseSessionView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the rep counter and wireframe without a visible demo video', () => {
    const onExit = vi.fn();
    act(() => {
      root.render(
        <MirrorExerciseSessionView
          exercise={sampleExercise}
          videoRef={{ current: null }}
          cameraStageRef={{ current: null }}
          pose={null}
          videoFrameSize={null}
          isHandTrace={false}
          repCount={3}
          targetReps={10}
          countdownStep="ready"
          paused={false}
          showCountdownOverlay={false}
          demoVideoUrl={sampleExercise.demoVideoUrl}
          demoVideoLoadState="ready"
          demoVideoError={null}
          onRetryDemoVideo={() => {}}
          cameraError={null}
          onExit={onExit}
        />,
      );
    });
    expect(container.querySelector('[data-testid="mirror-exercise-rep-count"]')?.textContent).toContain('3');
    expect(container.querySelector('[data-testid="mirror-exercise-demo"]')).toBeNull();

    const videos = [...container.querySelectorAll('video')];
    expect(videos).toHaveLength(1);
    const camera = videos[0];
    expect(camera?.getAttribute('data-testid')).toBe('mirror-exercise-camera');

    const videoContainer = container.querySelector('[data-testid="mirror-exercise-video-container"]');
    expect(videoContainer?.contains(camera)).toBe(true);

    const stage = container.querySelector('[data-testid="mirror-exercise-stage"]');
    expect(stage?.className).toContain('bg-black');
    expect(stage?.contains(videoContainer)).toBe(true);
    expect(camera?.className).toContain('mirror-video');
    expect(camera?.className).toContain('object-contain');
    expect(camera?.className).not.toContain('opacity-0');
    expect(camera?.className).not.toContain('-left-[9999px]');
    expect(container.querySelector('[data-testid="mirror-exercise-wireframe"]')).not.toBeNull();
  });

  describe('on the portrait stage', () => {
    const renderView = (overrides: Partial<Parameters<typeof MirrorExerciseSessionView>[0]> = {}) => {
      const cameraStageRef = { current: null as HTMLDivElement | null };
      act(() => {
        root.render(
          <MirrorExerciseSessionView
            exercise={sampleExercise}
            videoRef={{ current: null }}
            cameraStageRef={cameraStageRef}
            pose={null}
            videoFrameSize={null}
            isHandTrace={false}
            repCount={4}
            targetReps={10}
            countdownStep="ready"
            paused={false}
            showCountdownOverlay={false}
            demoVideoUrl={null}
            demoVideoLoadState="ready"
            demoVideoError={null}
            onRetryDemoVideo={() => {}}
            cameraError={null}
            onExit={() => {}}
            formCorrection="Keep your knees behind your toes"
            {...overrides}
          />,
        );
      });
      return cameraStageRef;
    };

    const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

    it('turns the camera video and wireframe back a quarter turn so the patient looks the same as before', () => {
      renderView();
      const turn = q('mirror-exercise-camera-turn')!;
      expect(turn).not.toBeNull();
      // The stage is rotated 90° left; this box turns 90° right inside it, so the camera picture is unrotated on the TV.
      expect(turn.className).toContain('rotate-90');
      // Landscape box: as wide as the portrait stage is tall, as tall as it is wide.
      expect(turn.className).toContain('w-[100cqh]');
      expect(turn.className).toContain('h-[100cqw]');
      expect(turn.className).toContain('-translate-x-1/2');
      expect(turn.className).toContain('-translate-y-1/2');
      expect(q('mirror-exercise-stage')!.className).toContain('[container-type:size]');
      expect(turn.contains(q('mirror-exercise-video-container'))).toBe(true);
      expect(turn.contains(q('mirror-exercise-camera'))).toBe(true);
      expect(turn.contains(q('mirror-exercise-wireframe'))).toBe(true);
    });

    it('keeps the eye-follow measurements on the turned (landscape) box', () => {
      const ref = renderView();
      expect(ref.current).toBe(q('mirror-exercise-camera-turn'));
    });

    it('keeps the rep counter, corrections and Exit upright, outside the turned box', () => {
      renderView();
      const turn = q('mirror-exercise-camera-turn')!;
      for (const id of ['mirror-exercise-rep-count', 'mirror-exercise-form-correction', 'mirror-exercise-exit']) {
        const el = q(id);
        expect(el, id).not.toBeNull();
        expect(turn.contains(el), id).toBe(false);
        expect(q('mirror-exercise-card')!.contains(el), id).toBe(true);
      }
    });

    it('shows the countdown and pause overlays upright too', () => {
      renderView({ showCountdownOverlay: true, paused: true });
      const turn = q('mirror-exercise-camera-turn')!;
      const countdown = [...container.querySelectorAll('p')].find((p) => p.textContent === 'GET READY');
      const paused = [...container.querySelectorAll('p')].find((p) => p.textContent === 'Paused');
      expect(countdown && paused).toBeTruthy();
      expect(turn.contains(countdown!)).toBe(false);
      expect(turn.contains(paused!)).toBe(false);
    });

    it('lays Exit over the bottom of the picture so the video keeps the full screen height', () => {
      renderView();
      const exitRow = q('mirror-exercise-exit')!.parentElement!;
      expect(q('mirror-exercise-stage')!.contains(exitRow)).toBe(true);
      expect(exitRow.className).toContain('absolute');
      expect(exitRow.className).toContain('bottom-');
    });
  });
});
