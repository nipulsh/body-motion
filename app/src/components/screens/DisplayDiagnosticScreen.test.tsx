/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDisplaySnapshot, type MonitorReading } from '../../display/smartMirrorDisplay';
import { DisplayDiagnosticView } from './DisplayDiagnosticScreen';

const laptop: MonitorReading = {
  name: 'Laptop',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1.25,
};

const tv: MonitorReading = {
  name: 'TV',
  x: 1920,
  y: 0,
  width: 1080,
  height: 1920,
  scaleFactor: 1,
};

describe('DisplayDiagnosticView', () => {
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

  it('shows the primary display and the portrait external candidate', () => {
    render(buildDisplaySnapshot({
      runtimeAvailable: true,
      topology: 'extend',
      monitors: [laptop, tv],
      primary: laptop,
    }));

    expect(container.textContent).toContain('Laptop');
    expect(container.textContent).toContain('Primary');
    expect(container.textContent).toContain('1920×1080 at 0,0');
    expect(container.textContent).toContain('scale 1.25');
    expect(container.textContent).toContain('TV');
    expect(container.textContent).toContain('1080×1920 at 1920,0');
    expect(container.textContent).toContain('portrait');
    expect(container.querySelector('[data-testid="display-selection-status"]')?.textContent).toBe('selected');
    expect(container.querySelector('[data-testid="display-candidate"]')?.textContent).toContain('TV');
  });

  it('explains when no external display is available', () => {
    render(buildDisplaySnapshot({
      runtimeAvailable: true,
      topology: 'single',
      monitors: [laptop],
      primary: laptop,
    }));
    expect(container.querySelector('[data-testid="display-selection-status"]')?.textContent).toBe('none');
    expect(container.textContent).toContain('Extend');
  });

  function render(snapshot: ReturnType<typeof buildDisplaySnapshot>) {
    act(() => {
      root.render(<DisplayDiagnosticView snapshot={snapshot} error={null} onRefresh={() => undefined} />);
    });
  }
});
