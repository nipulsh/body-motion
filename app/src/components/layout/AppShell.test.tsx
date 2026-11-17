/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('../../hooks/useSmartMirrorWindow', () => ({
  useSmartMirrorWindow: () => ({ phase: 'closed' }),
}));

vi.mock('../smartMirror/MirrorHandNavigationLayer', () => ({
  MirrorHandNavigationLayer: ({ children }: { children: ReactNode }) => (
    <div data-testid="hand-nav">{children}</div>
  ),
  MirrorHandStatusBanner: () => <p data-testid="hand-status">Make a fist to select.</p>,
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
    expect(stage?.getAttribute('data-rotated')).toBe('true');
    expect(stage?.textContent).toContain('kiosk');
    expect(container.querySelector('[data-testid="hand-nav"]')?.contains(stage)).toBe(true);
  });

  it('has no flat (sideways) mode left', () => {
    act(() => {
      root.render(
        // @ts-expect-error: the rotate prop is gone; every page is portrait.
        <AppShell rotate={false}>
          <p>exercise</p>
        </AppShell>,
      );
    });
    expect(container.querySelector('[data-testid="kiosk-screen-rotate"]')?.getAttribute('data-rotated')).toBe('true');
  });

  it('puts the hand-control hints inside the rotated stage so they read upright', () => {
    act(() => {
      root.render(
        <AppShell>
          <p>kiosk</p>
        </AppShell>,
      );
    });
    const stage = container.querySelector('[data-testid="kiosk-screen-rotate"]');
    expect(stage?.querySelector('[data-testid="hand-status"]')).not.toBeNull();
  });
});
