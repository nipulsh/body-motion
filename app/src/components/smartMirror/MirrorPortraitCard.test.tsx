/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MirrorPortraitCard } from './MirrorPortraitCard';

describe('MirrorPortraitCard', () => {
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

  it('fills the OS viewport without a nested phone frame', () => {
    act(() => {
      root.render(
        <MirrorPortraitCard testId="mirror-shell">
          <span>child</span>
        </MirrorPortraitCard>,
      );
    });
    const shell = container.querySelector('[data-testid="mirror-shell"]');
    expect(shell?.className).toMatch(/h-full/);
    expect(shell?.className).toMatch(/w-full/);
    expect(shell?.className).not.toMatch(/border-black/);
    expect(container.querySelectorAll('[data-testid="mirror-shell"]')).toHaveLength(1);
  });
});
