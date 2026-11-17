/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameModule } from '../../games/rehab/core/module';
import { REHAB_GAMES } from '../../games/rehab/registry';
import { RehabHome } from './RehabHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(games: readonly GameModule[], game = games[0], extra: Partial<Parameters<typeof RehabHome>[0]> = {}) {
  const props = {
    games,
    game,
    levels: game.levels(game.normalizeOptions ? game.normalizeOptions(game.defaultOptions) : game.defaultOptions),
    lastLevelIndex: 0,
    options: game.normalizeOptions ? game.normalizeOptions(game.defaultOptions) : game.defaultOptions,
    starsFor: () => 0,
    showSafetyLine: false,
    onSelectGame: vi.fn(),
    onStart: vi.fn(),
    onOption: vi.fn(),
    onExit: vi.fn(),
    onGear: vi.fn(),
    ...extra,
  };
  act(() => root.render(<RehabHome {...props} />));
  return props;
}

const gameButtons = () => Array.from(host.querySelectorAll('[data-testid^="rehab-game-"]')).map((b) => b.getAttribute('data-testid'));

describe('RehabHome', () => {
  it('lists exactly the registered games', () => {
    render(REHAB_GAMES);
    expect(gameButtons()).toEqual(['rehab-game-squat', 'rehab-game-bubbles', 'rehab-game-march']);
  });

  it('lists only what the registry gives it: a new game needs one registry line', () => {
    const extra: GameModule = { ...REHAB_GAMES[2], id: 'newgame', name: 'New game' };
    render([REHAB_GAMES[0], extra]);
    expect(gameButtons()).toEqual(['rehab-game-squat', 'rehab-game-newgame']);
    expect(host.textContent).toContain('New game');
    expect(host.textContent).not.toContain('Cross-Over Bubbles');
  });

  it('shows five level rings and starts a level with one press', () => {
    const props = render(REHAB_GAMES);
    const rings = host.querySelectorAll('[data-testid^="rehab-level-"]');
    expect(rings).toHaveLength(5);
    act(() => (rings[2] as HTMLButtonElement).click());
    expect(props.onStart).toHaveBeenCalledWith(2);
  });

  it('Exit is one press', () => {
    const props = render(REHAB_GAMES);
    act(() => (host.querySelector('[data-testid="rehab-exit"]') as HTMLButtonElement).click());
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('shows the first-run safety line', () => {
    render(REHAB_GAMES, REHAB_GAMES[0], { showSafetyLine: true });
    expect(host.textContent).toContain("Use under a physiotherapist's guidance.");
  });

  it('shows Fruit Catcher style chips only in side view', () => {
    const squat = REHAB_GAMES[0];
    render(REHAB_GAMES, squat, { options: { view: 'front', style: 'standard' } });
    expect(host.textContent).not.toContain('Hip bias');
    render(REHAB_GAMES, squat, { options: { view: 'side', style: 'standard' }, levels: squat.levels({ view: 'side', style: 'standard' }) });
    expect(host.textContent).toContain('Hip bias');
  });
});
