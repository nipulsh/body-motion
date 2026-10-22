/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartMirrorExercisePlanScreen } from './SmartMirrorExercisePlanScreen';

const dispatch = vi.fn();

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({
    dispatch,
    state: {
      exercises: [{ id: 'squat', name: 'Squat', description: '', sets: 1, recommendedReps: 8, restSeconds: 30, difficulty: 'easy', instructions: [], modality: 'reps', demoVideoUrl: null, targets: {} }],
    },
  }),
}));

describe('SmartMirrorExercisePlanScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dispatch.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('starts mirror exercise session for selected exercise', () => {
    act(() => {
      root.render(<SmartMirrorExercisePlanScreen />);
    });
    const pick = container.querySelector<HTMLButtonElement>('[data-testid="mirror-exercise-pick-0"]');
    act(() => pick?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EXERCISE_INDEX', index: 0 });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_exercise_session' });
  });
});
