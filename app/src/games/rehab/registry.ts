import { bubblesModule } from './bubbles/bubblesModule';
import type { GameModule } from './core/module';
import { marchModule } from './march/marchModule';
import { squatModule } from './squat/squatModule';

/**
 * Registered Mirror Rehab games. The home screen lists exactly these.
 * Adding a game: a new folder with a GameModule, plus one line here.
 */
export const REHAB_GAMES: readonly GameModule[] = [
  squatModule,
  bubblesModule,
  marchModule,
];

export function findRehabGame(id: string): GameModule {
  return REHAB_GAMES.find((g) => g.id === id) ?? REHAB_GAMES[0];
}
