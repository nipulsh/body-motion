/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, RepDetectionResult } from '@vision';
import { useSmartMirrorExercise } from './useSmartMirrorExercise';

type FrameListener = (payload: { result: RepDetectionResult | null }) => void;

const listeners = vi.hoisted(() => new Set<FrameListener>());
const session = vi.hoisted(() => ({
  exercise: null as Exercise | null,
  result: null as RepDetectionResult | null,
}));

vi.mock('@vision', () => ({
  getVisionManager: () => ({
    getActiveExercise: () => session.exercise,
    getLastRepResult: () => session.result,
    subscribeExerciseFrame: (listener: FrameListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }),
}));

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'shoulder_abduction',
    name: 'Shoulder Abduction',
    description: '',
    targetBodyParts: [],
    difficulty: 'beginner',
    sets: 2,
    recommendedReps: 12,
    restSeconds: 10,
    instructions: [],
    safetyNotes: [],
    trackingRules: [],
    demoVideoUrl: null,
    ...overrides,
  };
}

function result(repCount: number, exerciseId = 'shoulder_abduction'): RepDetectionResult {
  return {
    exerciseId,
    repCount,
    targetReps: 12,
    phase: 'REP_COMPLETED',
    valid: true,
    progress: 1,
    feedback: 'Good',
    rules: {},
    completed: false,
  };
}

describe('useSmartMirrorExercise', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listeners.clear();
    session.exercise = null;
    session.result = null;
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

  it('follows the active exercise and only re-renders when the count changes', async () => {
    let renders = 0;

    function Probe() {
      renders += 1;
      const snapshot = useSmartMirrorExercise();
      return (
        <p>
          {snapshot.exercise?.name ?? 'none'} {snapshot.repCount ?? '-'} / {snapshot.targetReps ?? '-'}
        </p>
      );
    }

    await act(async () => {
      root.render(<Probe />);
    });
    expect(container.textContent).toContain('none');
    const rendersAtRest = renders;

    session.exercise = exercise();
    session.result = result(1);
    act(() => {
      for (const listener of listeners) listener({ result: session.result });
    });
    expect(container.textContent).toContain('Shoulder Abduction 1 / 12');

    const rendersAfterCount = renders;
    expect(rendersAfterCount).toBeGreaterThan(rendersAtRest);
    act(() => {
      for (const listener of listeners) listener({ result: result(1) });
      for (const listener of listeners) listener({ result: null });
    });
    expect(renders).toBe(rendersAfterCount);

    session.result = result(2);
    act(() => {
      for (const listener of listeners) listener({ result: session.result });
    });
    expect(container.textContent).toContain('Shoulder Abduction 2 / 12');

    session.exercise = exercise({
      id: 'knee_extension',
      name: 'Knee Extension',
      recommendedReps: 10,
    });
    act(() => {
      for (const listener of listeners) listener({ result: result(2) });
    });
    expect(container.textContent).toContain('Knee Extension 0 / 10');
  });
});