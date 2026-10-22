/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisionManager, type Exercise } from '@vision';
import { SmartMirrorScreen } from './SmartMirrorScreen';

function sessionExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'shoulder_abduction',
    name: 'Shoulder Abduction',
    description: 'Raise the arm',
    targetBodyParts: ['shoulder'],
    difficulty: 'beginner',
    sets: 3,
    recommendedReps: 12,
    restSeconds: 20,
    instructions: [],
    safetyNotes: [],
    trackingRules: [],
    demoVideoUrl: null,
    ...overrides,
  };
}

const mirrorPose = vi.hoisted(() => ({ error: null as string | null }));

vi.mock('../../hooks/useSmartMirrorPose', () => ({
  useSmartMirrorPose: () => ({ error: mirrorPose.error }),
}));

describe('SmartMirrorScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mirrorPose.error = null;
    getVisionManager().stopExerciseSession();
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('fills the viewport with a wireframe layer and a floating exercise overlay', () => {
    act(() => {
      root.render(<SmartMirrorScreen />);
    });

    const screen = container.querySelector<HTMLElement>('[data-testid="smart-mirror-screen"]');
    const wireframe = container.querySelector<HTMLElement>('[data-testid="smart-mirror-wireframe"]');
    const exercise = container.querySelector<HTMLElement>('[data-testid="smart-mirror-exercise"]');

    expect(screen).not.toBeNull();
    expect(screen?.style.width).toBe('100%');
    expect(screen?.style.height).toBe('100%');
    expect(screen?.style.overflow).toBe('hidden');
    expect(screen?.style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(screen?.style.margin).toBe('0px');
    expect(screen?.style.padding).toBe('0px');

    expect(wireframe?.style.position).toBe('absolute');
    expect(wireframe?.style.inset).toBe('0px');
    expect(wireframe?.style.width).toBe('100%');
    expect(wireframe?.style.height).toBe('100%');
    expect(wireframe?.querySelector('canvas')).not.toBeNull();

    expect(exercise?.parentElement).toBe(screen);
    expect(exercise?.style.position).toBe('absolute');
    expect(exercise?.style.top).toBe('2%');
    expect(exercise?.style.right).toBe('2%');
    expect(exercise?.style.width).toBe('33%');
    expect(exercise?.style.zIndex).toBe('10');
    expect(Number(exercise?.style.zIndex)).toBeGreaterThan(Number(wireframe?.style.zIndex));
    expect(container.textContent).not.toContain('Shoulder Abduction');
    expect(container.textContent).not.toContain('00 / 12');
    expect(container.querySelector('video')).toBeNull();
  });

  it('shows the session exercise, placeholder demo, and detector rep count', () => {
    act(() => {
      root.render(
        <SmartMirrorScreen
          exercise={sessionExercise()}
          repCount={8}
          targetReps={12}
        />,
      );
    });

    expect(container.textContent).toContain('Shoulder Abduction');
    expect(container.textContent).toContain('08 / 12');
    expect(container.textContent).toContain('Demo video coming soon');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[aria-label="Reps 8 of 12"]')).not.toBeNull();
  });

  it('updates the name and rep count without moving the wireframe', () => {
    act(() => {
      root.render(
        <SmartMirrorScreen
          exercise={sessionExercise()}
          repCount={1}
          targetReps={12}
        />,
      );
    });

    const wireframe = container.querySelector<HTMLElement>('[data-testid="smart-mirror-wireframe"]');
    const canvas = wireframe?.querySelector('canvas');

    act(() => {
      root.render(
        <SmartMirrorScreen
          exercise={sessionExercise({
            id: 'squat',
            name: 'Squat',
            recommendedReps: 15,
            demoVideoUrl: '/exercise-videos/squat.webm',
          })}
          repCount={2}
          targetReps={15}
        />,
      );
    });

    expect(container.textContent).toContain('Squat');
    expect(container.textContent).toContain('02 / 15');
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/exercise-videos/squat.webm');
    expect(container.querySelector('video')?.loop).toBe(true);
    expect(container.querySelector('video')?.muted).toBe(true);
    expect(wireframe?.style.position).toBe('absolute');
    expect(wireframe?.style.inset).toBe('0px');
    expect(wireframe?.style.width).toBe('100%');
    expect(wireframe?.style.height).toBe('100%');
    expect(wireframe?.querySelector('canvas')).toBe(canvas);
  });

  it('shows a camera error without replacing the exercise overlay', () => {
    mirrorPose.error = 'Camera access is required. Check permissions and try again.';

    act(() => {
      root.render(
        <SmartMirrorScreen exercise={sessionExercise()} repCount={8} targetReps={12} />,
      );
    });

    expect(container.textContent).toContain('Shoulder Abduction');
    expect(container.textContent).toContain('08 / 12');
    expect(container.textContent).toContain('Camera access is required');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[data-testid="smart-mirror-wireframe"] canvas')).not.toBeNull();
  });
});
