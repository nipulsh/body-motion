export interface BalanceScoreState {
  wasBalanced: boolean;
  points: number;
}

export function createBalanceScoreState(): BalanceScoreState {
  return { wasBalanced: false, points: 0 };
}

/**
 * Awards one point when the player transitions into a stable one-leg balance.
 * No points while already balanced; re-armed after both feet are down.
 */
export function applyBalanceScore(
  state: BalanceScoreState,
  balanced: boolean,
): { state: BalanceScoreState; awarded: boolean } {
  if (balanced && !state.wasBalanced) {
    return {
      state: { wasBalanced: true, points: state.points + 1 },
      awarded: true,
    };
  }
  if (!balanced) {
    return { state: { ...state, wasBalanced: false }, awarded: false };
  }
  return { state, awarded: false };
}
