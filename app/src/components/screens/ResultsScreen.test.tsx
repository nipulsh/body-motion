/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultsScreen } from './ResultsScreen';

const workflow = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    analysis: null as unknown,
    selectedMuscleIndex: null as number | null,
    riggedGlbUrl: null as string | null,
    glbUrl: null as string | null,
    jobId: 'job-1',
  },
}));

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({ dispatch: workflow.dispatch, state: workflow.state }),
}));
const viewer = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('../../bodyExplorer/BodyExplorerViewer', () => ({
  BodyExplorerViewer: (props: Record<string, unknown>) => {
    viewer.props = props;
    return <div data-testid="anatomy-viewer" />;
  },
}));
vi.mock('../../bodyExplorer/RiggedModelViewer', () => ({ RiggedModelViewer: () => <div /> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ResultsScreen (clinician)', () => {
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

  it('shows the measurement conflict note to the clinician (#8)', () => {
    workflow.state.analysis = {
      summary: 'Shoulder asymmetry',
      bodyRegion: 'shoulder',
      observedDeformation: 'Left shoulder depressed',
      affectedSide: 'left',
      measurementConflict: 'The AI analysis did not account for a measured deviation: Left knee held bent 40°',
      muscles: [
        { name: 'Left Deltoid', side: 'left', likelihood: 0.7, deformation: 'd', intensity: 0.5, reason: 'r', contributionPercent: 100, bodyExplorerId: 'left_deltoid' },
      ],
    };
    act(() => root.render(<ResultsScreen />));
    expect(container.textContent).toMatch(/did not account for a measured deviation/);
    expect(container.textContent).toContain('Shoulder asymmetry');
  });

  describe('numbered muscles (anatomy map)', () => {
    const muscle = (name: string, mesh?: string) => ({
      name, side: 'left', likelihood: 0.6, deformation: 'd', intensity: 0.5, reason: 'r', contributionPercent: 10,
      ...(mesh ? { bodyExplorerId: mesh } : {}),
    });
    beforeEach(() => {
      workflow.dispatch.mockClear();
      workflow.state.selectedMuscleIndex = null;
      workflow.state.analysis = {
        summary: 's', bodyRegion: 'knee', observedDeformation: 'o', affectedSide: 'left',
        muscles: [muscle('Left Biceps Femoris', 'left_biceps_femoris'), muscle('Unmapped'), muscle('Left Gastrocnemius', 'left_gastrocnemius')],
      };
    });

    it('numbers every finding in the list', () => {
      act(() => root.render(<ResultsScreen />));
      const badges = [...container.querySelectorAll('[data-testid^="finding-number-"]')].map((el) => el.textContent);
      expect(badges).toEqual(['1', '2', '3']);
    });

    it('gives the anatomy map matching numbered markers for muscles it can show', () => {
      act(() => root.render(<ResultsScreen />));
      expect(viewer.props!.markers).toEqual([
        { index: 0, number: 1, label: 'Left Biceps Femoris', meshNames: ['left_biceps_femoris'] },
        { index: 2, number: 3, label: 'Left Gastrocnemius', meshNames: ['left_gastrocnemius'] },
      ]);
      expect(viewer.props!.focusMeshNames).toEqual([]);
    });

    it('selecting a marker focuses that muscle; reset clears the selection', () => {
      act(() => root.render(<ResultsScreen />));
      act(() => (viewer.props!.onMarkerSelect as (i: number) => void)(2));
      expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_MUSCLE', index: 2 });

      workflow.state.selectedMuscleIndex = 2;
      act(() => root.render(<ResultsScreen />));
      expect(viewer.props!.focusMeshNames).toEqual(['left_gastrocnemius']);
      expect(viewer.props!.isolateSelected).toBe(true);
      expect(viewer.props!.selectedMarkerIndex).toBe(2);

      act(() => (viewer.props!.onResetView as () => void)());
      expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_MUSCLE', index: null });
    });
  });
});
