/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartMirrorResultsScreen } from './SmartMirrorResultsScreen';

const workflow = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    analysis: null as {
      summary: string;
      bodyRegion: string;
      observedDeformation: string;
      muscles: Array<{
        name: string;
        side: string;
        likelihood: number;
        deformation: string;
        intensity: number;
        reason: string;
        bodyExplorerId?: string;
        bodyExplorerMeshNames?: string[];
      }>;
    } | null,
    selectedMuscleIndex: null as number | null,
    riggedGlbUrl: null as string | null,
  },
}));

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({
    dispatch: workflow.dispatch,
    state: workflow.state,
  }),
}));

const viewerProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('../../bodyExplorer/BodyExplorerViewer', () => ({
  BodyExplorerViewer: ({
    highlightMeshNames = [],
    className,
    handControl = false,
    ...rest
  }: {
    highlightMeshNames?: string[];
    className?: string;
    handControl?: boolean;
    [key: string]: unknown;
  }) => (
    (viewerProps.current = { highlightMeshNames, className, handControl, ...rest }),
    <div
      data-testid="body-explorer-viewer"
      className={className}
      data-highlight-meshes={highlightMeshNames.join(',')}
      data-mirror-model={handControl ? 'true' : undefined}
    />
  ),
}));

function analysisWithMuscles() {
  return {
    summary: 'Observed asymmetry in shoulder elevation.',
    bodyRegion: 'Upper body',
    observedDeformation: 'Mild scapular winging',
    muscles: [
      {
        name: 'Trapezius',
        side: 'right',
        likelihood: 0.72,
        deformation: 'elevation',
        intensity: 0.5,
        reason: 'Compensatory activation during arm raise.',
        bodyExplorerId: 'Trapezius_R',
        bodyExplorerMeshNames: ['Trapezius_R', 'Trapezius_R_upper'],
      },
      {
        name: 'Deltoid',
        side: 'right',
        likelihood: 0.61,
        deformation: 'elevation',
        intensity: 0.4,
        reason: 'Elevated shoulder on the affected side.',
        bodyExplorerId: 'Deltoid_R',
      },
    ],
  };
}

describe('SmartMirrorResultsScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    workflow.dispatch.mockClear();
    workflow.state.analysis = analysisWithMuscles();
    workflow.state.selectedMuscleIndex = null;
    workflow.state.riggedGlbUrl = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('never shows the clinician-only measurement note to the patient (#8)', () => {
    workflow.state.analysis = {
      ...analysisWithMuscles(),
      measurementConflict: 'The AI analysis did not account for a measured deviation: knee',
    } as typeof workflow.state.analysis;
    act(() => {
      root.render(<SmartMirrorResultsScreen />);
    });
    expect(container.textContent).not.toMatch(/did not account for/);
  });

  it('numbers each muscle in the list and on the mirror anatomy map', () => {
    act(() => {
      root.render(<SmartMirrorResultsScreen />);
    });
    const badges = [...container.querySelectorAll('[data-testid^="finding-number-"]')].map((el) => el.textContent);
    expect(badges).toEqual(['1', '2']);
    expect((viewerProps.current!.markers as Array<{ number: number }>).map((m) => m.number)).toEqual([1, 2]);
    expect(viewerProps.current!.handControl).toBe(true);
  });

  it('zooms to the selected muscle and resets back to all muscles', () => {
    workflow.state.selectedMuscleIndex = 1;
    act(() => {
      root.render(<SmartMirrorResultsScreen />);
    });
    expect(viewerProps.current!.focusMeshNames).toEqual(['Deltoid_R']);
    act(() => (viewerProps.current!.onResetView as () => void)());
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_MUSCLE', index: null });
  });

  it('renders backend analysis fields', () => {
    act(() => {
      root.render(<SmartMirrorResultsScreen />);
    });
    expect(container.textContent).toContain('Observed asymmetry in shoulder elevation.');
    expect(container.textContent).toContain('Upper body');
    expect(container.textContent).toContain('Trapezius');
    expect(container.textContent).toContain('Compensatory activation during arm raise.');
  });

  it('renders the skeleton viewer from muscle findings when riggedGlbUrl is null', () => {
    workflow.state.riggedGlbUrl = null;

    act(() => {
      root.render(<SmartMirrorResultsScreen />);
    });

    const viewer = container.querySelector<HTMLElement>('[data-testid="body-explorer-viewer"]');
    expect(viewer).not.toBeNull();
    expect(viewer?.className).toContain('body-explorer-canvas');
    expect(viewer?.getAttribute('data-mirror-model')).toBe('true');
    const highlighted = viewer?.getAttribute('data-highlight-meshes')?.split(',') ?? [];
    expect(highlighted).toEqual(expect.arrayContaining(['Trapezius_R', 'Trapezius_R_upper', 'Deltoid_R']));
    expect(container.textContent).toContain('Trapezius');
    expect(container.textContent).toContain('Deltoid');
  });

  it('returns to mirror home', () => {
    act(() => {
      root.render(<SmartMirrorResultsScreen />);
    });
    const home = container.querySelector<HTMLButtonElement>('[data-testid="mirror-results-home"]');
    act(() => home?.click());
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_MUSCLE', index: null });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_home' });
  });

  it('selects a muscle group so only that group is shown on the skeleton', () => {
    workflow.state.selectedMuscleIndex = 1;
    act(() => {
      root.render(<SmartMirrorResultsScreen />);
    });
    const viewer = container.querySelector('[data-testid="body-explorer-viewer"]');
    expect(viewer?.getAttribute('data-highlight-meshes')).toBe('Deltoid_R');
    const muscle = container.querySelector<HTMLButtonElement>('[data-testid="mirror-muscle-0"]');
    act(() => muscle?.click());
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_MUSCLE', index: 0 });
  });
});
