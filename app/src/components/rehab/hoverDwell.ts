import { HOVER_ATTR } from './rehabUi';

/** Layout rectangle of `el` relative to `root`, ignoring CSS transforms (the kiosk rotates the stage). */
export function layoutRect(el: HTMLElement, root: HTMLElement): { x: number; y: number; w: number; h: number } | null {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent) return null;
    if (parent !== root && !root.contains(parent)) return null;
    // Scroll containers in this UI are positioned, so they are offset parents.
    if (parent !== root) {
      x -= parent.scrollLeft;
      y -= parent.scrollTop;
    }
    node = parent;
  }
  if (node !== root) return null;
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * Hand-hover activation: a target is clicked after the cursor stays on it for
 * its dwell time. After firing, the cursor must leave before it can fire again.
 */
export class HoverDwell {
  private target: HTMLElement | null = null;
  private since = 0;
  private fired = false;

  clear(): void {
    if (this.target) this.target.removeAttribute('data-hover');
    this.target = null;
    this.fired = false;
  }

  /** Returns dwell progress 0..1 for drawing the cursor ring. */
  update(root: HTMLElement, point: { x: number; y: number } | null, now: number, allowAll: boolean, defaultDwell: number): number {
    let hit: HTMLElement | null = null;
    if (point) {
      const els = root.querySelectorAll<HTMLElement>(`[${HOVER_ATTR}]`);
      for (const el of els) {
        if ((el as HTMLButtonElement).disabled) continue;
        if (!allowAll && el.dataset.rehabAlways !== 'true') continue;
        const r = layoutRect(el, root);
        if (!r) continue;
        if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) hit = el;
      }
    }
    if (hit !== this.target) {
      this.target?.removeAttribute('data-hover');
      hit?.setAttribute('data-hover', 'true');
      this.target = hit;
      this.since = now;
      this.fired = false;
    }
    if (!hit || this.fired) return 0;
    const dwell = Number(hit.dataset.dwell) > 0 ? Number(hit.dataset.dwell) : defaultDwell;
    const progress = (now - this.since) / dwell;
    if (progress >= 1) {
      this.fired = true;
      hit.click();
      return 0;
    }
    return progress;
  }
}
