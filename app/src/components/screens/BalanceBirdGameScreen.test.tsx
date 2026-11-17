/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BalanceBirdGameScreen } from './BalanceBirdGameScreen';

const dispatch = vi.fn();

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({ dispatch }),
}));

vi.mock('../../hooks/useBalanceBirdGame', () => ({
  useBalanceBirdGame: () => ({
    videoRef: { current: null },
    canvasRef: { current: null },
    stageRef: { current: null },
    balance: { balanced: false, supportLeg: 'none', confidence: 0, detail: 'no_pose' },
    points: 2,
    cameraError: null,
    cameraTurn: 270,
    pictureAspect: 9 / 16,
  }),
}));

describe('BalanceBirdGameScreen', () => {
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

  it('shows points from gameplay state', () => {
    act(() => {
      root.render(<BalanceBirdGameScreen />);
    });
    expect(container.querySelector('[data-testid="mirror-game-points"]')?.textContent).toContain('2');
  });

  it('opens and closes game rules without leaving the game', () => {
    act(() => {
      root.render(<BalanceBirdGameScreen />);
    });
    const open = container.querySelector<HTMLButtonElement>('[data-testid="mirror-game-rules-open"]');
    act(() => open?.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const close = container.querySelector<HTMLButtonElement>('[data-testid="mirror-game-rules-close"]');
    act(() => close?.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="mirror-game-stage"]')).not.toBeNull();
  });

  it('returns to mirror home on exit', () => {
    act(() => {
      root.render(<BalanceBirdGameScreen />);
    });
    const exit = container.querySelector<HTMLButtonElement>('[data-testid="mirror-game-exit"]');
    act(() => exit?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_home' });
  });

  it('shows the camera picture upright and mirrored on the portrait stage, filling the height', () => {
    act(() => {
      root.render(<BalanceBirdGameScreen />);
    });
    const stage = container.querySelector('[data-testid="mirror-game-stage"]')!;
    expect(stage.className).toContain('[container-type:size]');
    const video = stage.querySelector('video')!;
    expect(video.getAttribute('data-camera-turn')).toBe('270');
    expect(video.style.transform).toBe('translate(-50%, -50%) scaleX(-1) rotate(270deg)');
    expect(video.className).not.toContain('object-contain');
    expect(video.className).not.toContain('inset-0');
  });
});
