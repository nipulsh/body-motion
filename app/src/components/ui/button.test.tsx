/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, buttonVariants } from './button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
const classes = (variant: (typeof VARIANTS)[number]) => buttonVariants({ variant }).split(/\s+/);

describe('button hover effect (unit)', () => {
  it('shows a pointer cursor on every variant', () => {
    for (const variant of VARIANTS) expect(classes(variant), variant).toContain('cursor-pointer');
  });

  it('gives every variant a visible hover change', () => {
    for (const variant of VARIANTS) {
      expect(classes(variant).some((c) => c.startsWith('hover:')), variant).toBe(true);
    }
  });

  it('lifts filled and outline buttons on hover and settles them when pressed', () => {
    for (const variant of ['default', 'destructive', 'outline', 'secondary'] as const) {
      const list = classes(variant);
      expect(list, variant).toContain('motion-safe:hover:-translate-y-px');
      expect(list.some((c) => c.startsWith('hover:shadow')), variant).toBe(true);
      expect(list, variant).toContain('active:translate-y-0');
    }
  });

  it('keeps ghost and link buttons flat (they sit inside toolbars and text)', () => {
    for (const variant of ['ghost', 'link'] as const) {
      expect(classes(variant), variant).not.toContain('motion-safe:hover:-translate-y-px');
    }
  });

  it('respects reduced motion', () => {
    const base = classes('default');
    expect(base).toContain('motion-reduce:transition-none');
    // The lift only exists under motion-safe, so reduced-motion users never get it.
    expect(base.filter((c) => /(^|:)hover:-?translate/.test(c)).every((c) => c.startsWith('motion-safe:'))).toBe(true);
  });

  it('uses a short ease-out transition instead of animating everything', () => {
    const base = classes('default');
    expect(base).not.toContain('transition-all');
    expect(base).toContain('duration-150');
    expect(base).toContain('ease-out');
  });

  it('never shows a hover state on a disabled button', () => {
    expect(classes('default')).toContain('disabled:pointer-events-none');
  });
});

describe('button hover effect (integration)', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  function render(node: React.ReactNode) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(node));
    return host;
  }

  it('applies the hover classes to rendered buttons and asChild links, keeping caller classes', () => {
    const el = render(
      <>
        <Button className="w-full">Save</Button>
        <Button asChild variant="outline">
          <a href="/x">Open</a>
        </Button>
      </>,
    );
    const button = el.querySelector('button')!;
    const link = el.querySelector('a')!;
    expect(button.className).toContain('motion-safe:hover:-translate-y-px');
    expect(button.className).toContain('w-full');
    expect(link.className).toContain('cursor-pointer');
    expect(link.className).toContain('motion-safe:hover:-translate-y-px');
  });

  it('gives plain <button> elements outside the Button component a pointer cursor', () => {
    const css = readFileSync(path.resolve(__dirname, '../../styles/app.css'), 'utf8');
    const base = css.slice(css.indexOf('@layer base'));
    expect(base).toMatch(/button:not\(:disabled\)[^{]*\{[^}]*cursor:\s*pointer/);
  });
});
