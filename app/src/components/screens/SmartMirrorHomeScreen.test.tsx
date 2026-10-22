/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartMirrorHomeScreen } from './SmartMirrorHomeScreen';

const dispatch = vi.fn();

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({
    dispatch,
    state: { activePatient: null },
  }),
}));

vi.mock('../../hooks/useRequiresOnline', () => ({
  useRequiresOnline: () => ({ isOnline: true, offlineMessage: 'Offline' }),
}));

describe('SmartMirrorHomeScreen', () => {
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
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SCAN_CAPTURE_MODE', mode: 'TIMED_BURST' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_JOB_COMPLETE_STAGE', stage: 'mirror_results' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'RESET_CAPTURES' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SCAN', scanId: null });
    expect(dispatch).toHaveBeenCalledWith({ type: 'CLEAR_JOB' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_analysis' });
  });

  it('opens balance bird game directly', () => {
    renderHome();
    const game = container.querySelector<HTMLButtonElement>('[data-testid="mirror-home-game"]');
    act(() => game?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'balance_bird_game' });
  });
});
