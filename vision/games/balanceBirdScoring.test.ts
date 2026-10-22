import { describe, expect, it } from 'vitest';
import { applyBalanceScore, createBalanceScoreState } from './balanceBirdScoring';

describe('balanceBirdScoring', () => {
  it('starts at zero points', () => {
    expect(createBalanceScoreState().points).toBe(0);
  });

  it('awards one point on balance onset only once per hold', () => {
    let state = createBalanceScoreState();
    const first = applyBalanceScore(state, true);
    expect(first.awarded).toBe(true);
    expect(first.state.points).toBe(1);

    const held = applyBalanceScore(first.state, true);
    expect(held.awarded).toBe(false);
    expect(held.state.points).toBe(1);

    const released = applyBalanceScore(held.state, false);
    const again = applyBalanceScore(released.state, true);
    expect(again.awarded).toBe(true);
    expect(again.state.points).toBe(2);
  });
});
