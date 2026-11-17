/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MirrorHandNavigationLayer, MirrorHandStatusBanner } from './MirrorHandNavigationLayer';

const nav = vi.hoisted(() => ({
  status: 'ready' as 'idle' | 'starting' | 'ready' | 'error',
  error: null as string | null,
}));

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({ state: { stage: 'mirror_home' } }),
}));
vi.mock('./MirrorHandNavContext', () => ({
  useMirrorHandNav: () => ({ analysisCaptureActive: false, exerciseHandTrackingActive: false }),
}));
vi.mock('../../hooks/useSmartMirrorHandNavigation', () => ({
  useSmartMirrorHandNavigation: () => ({
    pointer: { x: 120, y: 340, visible: true, overTarget: false },
    status: nav.status,
    error: nav.error,
  }),
}));

describe('MirrorHandNavigationLayer on the portrait stage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    nav.status = 'ready';
    nav.error = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderLayer = () =>
    act(() => {
      root.render(
        <MirrorHandNavigationLayer>
          <div data-testid="stage">
            <MirrorHandStatusBanner />
          </div>
        </MirrorHandNavigationLayer>,
      );
    });

  it('shows the hand-control hint where the banner sits (inside the rotated stage), not over the raw screen', () => {
    renderLayer();
    const stage = container.querySelector('[data-testid="stage"]')!;
    const hint = [...container.querySelectorAll('p')].find((p) => p.textContent?.includes('Make a fist to select'));
    expect(hint).toBeDefined();
    expect(stage.contains(hint!)).toBe(true);
    // Positioned against the stage, not the unrotated window.
    expect(hint!.className).toContain('absolute');
    expect(hint!.className).not.toContain('fixed');
  });

  it('shows the starting and error messages in the same place', () => {
    nav.status = 'starting';
    renderLayer();
    const stage = container.querySelector('[data-testid="stage"]')!;
    expect(stage.textContent).toContain('Starting hand control');

    nav.status = 'error';
    nav.error = 'camera busy';
    renderLayer();
    expect(container.querySelector('[data-testid="stage"]')!.querySelector('[role="status"]')).not.toBeNull();
  });

  it('keeps the pointer dot outside the stage, on window coordinates', () => {
    renderLayer();
    const dot = container.querySelector<HTMLElement>('[data-testid="mirror-hand-pointer"]')!;
    expect(dot).not.toBeNull();
    expect(container.querySelector('[data-testid="stage"]')!.contains(dot)).toBe(false);
    expect(dot.className).toContain('fixed');
    expect(dot.style.left).toBe('120px');
    expect(dot.style.top).toBe('340px');
  });

  it('shows nothing from the banner outside the layer', () => {
    act(() => root.render(<MirrorHandStatusBanner />));
    expect(container.textContent).toBe('');
  });
});
