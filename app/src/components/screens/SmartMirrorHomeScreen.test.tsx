/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartMirrorHomeScreen } from './SmartMirrorHomeScreen';

const workflow = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    activePatient: null,
    jobId: null as string | null,
    jobStatus: null as { status: string } | null,
    analysis: null as { summary: string } | null,
  },
}));

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({
    dispatch: workflow.dispatch,
    state: workflow.state,
  }),
}));

vi.mock('../../hooks/useRequiresOnline', () => ({
  useRequiresOnline: () => ({ isOnline: true, offlineMessage: 'Offline' }),
}));

describe('SmartMirrorHomeScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    workflow.dispatch.mockClear();
    workflow.state.jobId = null;
    workflow.state.jobStatus = null;
    workflow.state.analysis = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderHome() {
    act(() => {
      root.render(<SmartMirrorHomeScreen />);
    });
  }

  it('renders exactly three menu buttons with sketch labels', () => {
    renderHome();
    const buttons = container.querySelectorAll('nav button');
    expect(buttons).toHaveLength(3);
    expect(container.querySelector('[data-testid="mirror-home-analyse"]')?.textContent).toBe('Analyse');
    expect(container.querySelector('[data-testid="mirror-home-exercise"]')?.textContent).toBe('Exercise');
    expect(container.querySelector('[data-testid="mirror-home-game"]')?.textContent).toBe('Game');
  });

  it('uses the full viewport shell (no simulated device frame)', () => {
    renderHome();
    const card = container.querySelector('[data-testid="mirror-home-card"]');
    expect(card).not.toBeNull();
    expect(card?.className).toMatch(/h-full/);
    expect(card?.className).toMatch(/w-full/);
    expect(card?.className).not.toMatch(/42vw/);
    expect(card?.className).not.toMatch(/rounded-\[2\.5rem\]/);
  });

  it('opens mirror analysis screen with timed burst mode', () => {
    renderHome();
    const analyse = container.querySelector<HTMLButtonElement>('[data-testid="mirror-home-analyse"]');
    act(() => analyse?.click());
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_SCAN_CAPTURE_MODE', mode: 'TIMED_BURST' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_JOB_COMPLETE_STAGE', stage: 'mirror_results' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'RESET_CAPTURES' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_SCAN', scanId: null });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'CLEAR_JOB' });
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_analysis' });
  });

  it('blocks a new analysis while one is running and opens that job from Review analysis', () => {
    workflow.state.jobId = 'job-1';
    workflow.state.jobStatus = { status: 'PROCESSING' };
    renderHome();
    const analyse = container.querySelector<HTMLButtonElement>('[data-testid="mirror-home-analyse"]');
    expect(analyse?.disabled).toBe(true);
    act(() => analyse?.click());
    expect(workflow.dispatch).not.toHaveBeenCalled();

    const review = container.querySelector<HTMLButtonElement>('[data-testid="mirror-home-review"]');
    expect(review?.textContent).toBe('Review analysis');
    act(() => review?.click());
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_processing' });
  });

  it('opens the latest finished analysis from Review analysis', () => {
    workflow.state.jobId = 'job-1';
    workflow.state.jobStatus = { status: 'COMPLETED' };
    workflow.state.analysis = { summary: 'Done' };
    renderHome();
    const analyse = container.querySelector<HTMLButtonElement>('[data-testid="mirror-home-analyse"]');
    expect(analyse?.disabled).toBe(false);
    const review = container.querySelector<HTMLButtonElement>('[data-testid="mirror-home-review"]');
    act(() => review?.click());
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_results' });
  });

  it('opens balance bird game directly', () => {
    renderHome();
    const game = container.querySelector<HTMLButtonElement>('[data-testid="mirror-home-game"]');
    act(() => game?.click());
    expect(workflow.dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'balance_bird_game' });
  });
});
