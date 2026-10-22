/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MirrorWindowBounds } from '../display/mirrorWindow';
import { buildDisplaySnapshot, type MonitorReading } from '../display/smartMirrorDisplay';
import { SmartMirrorControls } from '../components/smartMirror/SmartMirrorControls';
import { useSmartMirrorWindow } from './useSmartMirrorWindow';

const laptop: MonitorReading = {
  name: 'Laptop',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1,
};

function Harness({
  load,
  openWindow,
}: {
  load: () => Promise<ReturnType<typeof buildDisplaySnapshot>>;
  openWindow: (bounds: MirrorWindowBounds) => Promise<'created' | 'focused'>;
}) {
  const mirror = useSmartMirrorWindow({
    load,
    openWindow,
    closeWindow: async () => undefined,
    isWindowOpen: async () => true,
  });
  return (
    <SmartMirrorControls
      phase={mirror.phase}
      error={mirror.error}
      choices={mirror.choices}
      collapsed={false}
      onOpen={() => void mirror.open()}
      onClose={() => void mirror.close()}
      onChoose={(displayId) => void mirror.open(displayId)}
    />
  );
}

describe('Open Smart Mirror', () => {
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

  it('shows an error and does not open a window when no external display exists', async () => {
    const openWindow = vi.fn(async () => 'created' as const);
    await act(async () => {
      root.render(
        <Harness
          load={async () => buildDisplaySnapshot({
            runtimeAvailable: true,
            topology: 'single',
            monitors: [laptop],
            primary: laptop,
          })}
          openWindow={openWindow}
        />,
      );
    });

    await act(async () => {
      container.querySelector('button')?.click();
    });

    expect(openWindow).not.toHaveBeenCalled();
    expect(container.textContent).toContain('No external display');
  });

  it('does not send a second open while the first one is still running', async () => {
    let resolveOpen: (value: 'created') => void = () => {};
    const openWindow = vi.fn((_bounds: MirrorWindowBounds) => new Promise<'created'>((resolve) => {
      resolveOpen = resolve;
    }));
    const tv: MonitorReading = {
      name: 'TV',
      x: 1920,
      y: 0,
      width: 1080,
      height: 1920,
      scaleFactor: 1,
    };
    await act(async () => {
      root.render(
        <Harness
          load={async () => buildDisplaySnapshot({
            runtimeAvailable: true,
            topology: 'extend',
            monitors: [laptop, tv],
            primary: laptop,
          })}
          openWindow={openWindow}
        />,
      );
    });

    const button = container.querySelector('button');
    await act(async () => {
      button?.click();
      button?.click();
    });
    expect(openWindow).toHaveBeenCalledTimes(1);
    const placement = openWindow.mock.calls[0]?.[0];
    expect(placement).toMatchObject({ x: 1920, width: 1080, height: 1920 });

    await act(async () => {
      resolveOpen('created');
    });
  });

  it('focuses the existing mirror window instead of treating it as a new one', async () => {
    const openWindow = vi.fn(async () => 'focused' as const);
    const tv: MonitorReading = {
      name: 'TV',
      x: 1920,
      y: 0,
      width: 1080,
      height: 1920,
      scaleFactor: 1,
    };
    await act(async () => {
      root.render(
        <Harness
          load={async () => buildDisplaySnapshot({
            runtimeAvailable: true,
            topology: 'extend',
            monitors: [laptop, tv],
            primary: laptop,
          })}
          openWindow={openWindow}
        />,
      );
    });
    await act(async () => {
      container.querySelector('button')?.click();
    });
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Close Smart Mirror');
  });
});
