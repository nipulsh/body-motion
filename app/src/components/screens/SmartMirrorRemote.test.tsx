/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartMirrorScreen } from './SmartMirrorScreen';

vi.mock('../../desktop/mirrorEvents', () => ({
  listenMirrorEvent: vi.fn(() => Promise.resolve(() => undefined)),
  mirrorEmitTo: vi.fn(),
}));

vi.mock('../../desktop/desktopApi', () => ({
  getDesktopBridge: () => ({ closeWindow: vi.fn() }),
}));

describe('remote Smart Mirror window', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not create a camera video element', () => {
    const create = vi.spyOn(document, 'createElement');
    act(() => {
      root.render(<SmartMirrorScreen remote />);
    });
    expect(create.mock.calls.some(([tag]) => tag === 'video')).toBe(false);
    expect(container.querySelector('video')).toBeNull();
    const wireframe = container.querySelector<HTMLElement>('[data-testid="smart-mirror-wireframe"]');
    expect(wireframe?.style.position).toBe('absolute');
    expect(container.textContent).toContain('Waiting for the laptop camera.');
  });
});
