/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KioskScreenRotate } from './KioskScreenRotate';

describe('KioskScreenRotate', () => {
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

  it('wraps children in the 90° left software-rotate stage', () => {
    act(() => {
      root.render(
        <KioskScreenRotate>
          <span>child</span>
        </KioskScreenRotate>,
      );
    });

    const stage = container.querySelector('[data-testid="kiosk-screen-rotate"]');
    expect(stage).not.toBeNull();
    expect(stage?.className).toBe('kiosk-screen-rotate');
    expect(stage?.getAttribute('data-rotated')).toBe('true');
    expect(stage?.textContent).toBe('child');
  });

  it('fills the landscape viewport when rotation is disabled', () => {
    act(() => {
      root.render(
        <KioskScreenRotate enabled={false}>
          <span>exercise</span>
        </KioskScreenRotate>,
      );
    });

    const stage = container.querySelector('[data-testid="kiosk-screen-rotate"]');
    expect(stage?.className).toBe('kiosk-screen-flat');
    expect(stage?.getAttribute('data-rotated')).toBe('false');
    expect(stage?.textContent).toBe('exercise');
  });
});
