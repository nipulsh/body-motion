import { MIRROR_MODEL_ATTR } from '@vision/hand/gestureTargets';

export type PinchDragTarget =
  | { kind: 'scroll'; element: HTMLElement }
  | { kind: 'model' }
  | { kind: 'none' };

function canScroll(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const scrollsY =
    (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight + 1;
  const scrollsX =
    (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'overlay') &&
    element.scrollWidth > element.clientWidth + 1;
  return scrollsY || scrollsX;
}

function scrollableAncestor(start: HTMLElement, root: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = start;
  while (current && current !== root) {
    if (canScroll(current)) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Topmost hit wins. A model marker beats a scrollable ancestor.
 * The root itself is not a drag target.
 */
export function resolvePinchDragTarget(
  root: HTMLElement,
  elements: readonly Element[],
): PinchDragTarget {
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;
    if (element !== root && !root.contains(element)) continue;

    if (element.closest(`[${MIRROR_MODEL_ATTR}="true"]`)) return { kind: 'model' };

    const scrollable = scrollableAncestor(element, root);
    if (scrollable) return { kind: 'scroll', element: scrollable };
  }
  return { kind: 'none' };
}

export function findPinchDragTarget(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): PinchDragTarget {
  const elements = root.ownerDocument.elementsFromPoint?.(clientX, clientY) ?? [];
  return resolvePinchDragTarget(root, elements);
}

/** Content follows the hand: dragging down reveals what was above. */
export function applyPinchScroll(element: HTMLElement, delta: { x: number; y: number }): void {
  element.scrollTop -= delta.y;
  element.scrollLeft -= delta.x;
}

export function applyPinchDrag(
  target: PinchDragTarget,
  delta: { x: number; y: number },
  model: { panBy(dx: number, dy: number): void } | null,
): void {
  switch (target.kind) {
    case 'scroll':
      applyPinchScroll(target.element, delta);
      return;
    case 'model':
      model?.panBy(delta.x, delta.y);
      return;
    case 'none':
      return;
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}
