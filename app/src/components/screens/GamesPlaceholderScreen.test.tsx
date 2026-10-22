/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamesPlaceholderScreen } from './GamesPlaceholderScreen';

const dispatch = vi.fn();

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({ dispatch, state: { stage: 'games_placeholder' } }),
}));

describe('GamesPlaceholderScreen', () => {
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

  it('opens the balance bird game', () => {
    act(() => {
      root.render(<GamesPlaceholderScreen />);
    });
    const play = container.querySelector<HTMLButtonElement>('[data-testid="play-balance-bird"]');
    expect(play).not.toBeNull();
    act(() => play?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'balance_bird_game' });
  });

  it('returns to mirror home', () => {
    act(() => {
      root.render(<GamesPlaceholderScreen />);
    });
    const back = container.querySelector<HTMLButtonElement>('[data-testid="games-back-home"]');
    act(() => back?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_home' });
  });
});
