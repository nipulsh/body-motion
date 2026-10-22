/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('../../hooks/useSmartMirrorWindow', () => ({
  useSmartMirrorWindow: () => ({ phase: 'closed' }),
}));

vi.mock('../smartMirror/MirrorHandNavigationLayer', () => ({
  MirrorHandNavigationLayer: ({ children }: { children: unknown }) => (
    <div data-testid="hand-nav">{children}</div>
  ),
}));

vi.mock('../smartMirror/SmartMirrorPublisher', () => ({
  SmartMirrorPublisher: () => null,
}));

describe('AppShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('software-rotates kiosk screens 90° left', () => {
    act(() => {
      root.render(
        <AppShell>
          <p>kiosk</p>
        </AppShell>,
      );
    });

    const stage = container.querySelector('[data-testid="kiosk-screen-rotate"]');
    expect(stage).not.toBeNull();
    expect(stage?.className).toBe('kiosk-screen-rotate');
    expect(stage?.textContent).toBe('kiosk');
    expect(container.querySelector('[data-testid="hand-nav"]')?.contains(stage)).toBe(true);
  });

  it('leaves the stage unrotated when rotate is false', () => {
    act(() => {
      root.render(
        <AppShell rotate={false}>
          <p>exercise</p>
        </AppShell>,
      );
    });

    const stage = container.querySelector('[data-testid="kiosk-screen-rotate"]');
    expect(stage?.className).toBe('kiosk-screen-flat');
    expect(stage?.textContent).toBe('exercise');
  });
});
