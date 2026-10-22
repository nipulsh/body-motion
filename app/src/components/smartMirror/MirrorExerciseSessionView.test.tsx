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
vi.mock('../vision/FingertipTrailOverlay', () => ({
  FingertipTrailOverlay: () => null,
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
          fingerTrail={[]}
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

    const stage = container.querySelector('[data-testid="mirror-exercise-stage"]');
    expect(stage?.className).toContain('bg-black');
    expect(stage?.contains(camera)).toBe(true);
    expect(camera?.className).toContain('mirror-video');
    expect(camera?.className).toContain('object-contain');
    expect(camera?.className).not.toContain('opacity-0');
    expect(camera?.className).not.toContain('-left-[9999px]');
    expect(container.querySelector('[data-testid="mirror-exercise-wireframe"]')).not.toBeNull();
  });
});
