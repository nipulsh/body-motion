/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { MIRROR_MODEL_ATTR } from '@vision/hand/gestureTargets';
import { applyPinchDrag, applyPinchScroll, resolvePinchDragTarget } from './pinchDragTarget';

function scrollableBox(): HTMLElement {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  Object.defineProperty(element, 'scrollHeight', { value: 400, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: 100, configurable: true });
  return element;
}

describe('resolvePinchDragTarget', () => {
  it('scrolls the list under the pinch', () => {
    const root = document.createElement('div');
    const list = scrollableBox();
    const item = document.createElement('p');
    list.appendChild(item);
    root.appendChild(list);

    expect(resolvePinchDragTarget(root, [item, list, root])).toEqual({
      kind: 'scroll',
      element: list,
    });
  });

  it('slides the model when the pinch is over the model marker', () => {
    const root = document.createElement('div');
    const list = scrollableBox();
    const model = document.createElement('div');
    model.setAttribute(MIRROR_MODEL_ATTR, 'true');
    const canvas = document.createElement('canvas');
    model.appendChild(canvas);
    list.appendChild(model);
    root.appendChild(list);

    expect(resolvePinchDragTarget(root, [canvas, model, list, root])).toEqual({ kind: 'model' });
  });

  it('scrolls a list when the pinch is on a button inside that list', () => {
    const root = document.createElement('div');
    const list = scrollableBox();
    const button = document.createElement('button');
    list.appendChild(button);
    root.appendChild(list);

    expect(resolvePinchDragTarget(root, [button, list, root])).toEqual({
      kind: 'scroll',
      element: list,
    });
  });

  it('does nothing over empty space or a button outside a list', () => {
    const root = document.createElement('div');
    const button = document.createElement('button');
    root.appendChild(button);

    expect(resolvePinchDragTarget(root, [button, root])).toEqual({ kind: 'none' });
    expect(resolvePinchDragTarget(root, [])).toEqual({ kind: 'none' });
  });
});

describe('applyPinchScroll', () => {
  it('moves the content with the hand', () => {
    const list = document.createElement('div');
    list.scrollTop = 80;
    list.scrollLeft = 10;

    applyPinchScroll(list, { x: 4, y: 25 });

    expect(list.scrollTop).toBe(55);
    expect(list.scrollLeft).toBe(6);
  });
});

describe('applyPinchDrag', () => {
  it('pans the model and scrolls a list', () => {
    const panBy = vi.fn();
    applyPinchDrag({ kind: 'model' }, { x: 12, y: -3 }, { panBy });
    expect(panBy).toHaveBeenCalledWith(12, -3);

    const list = document.createElement('div');
    list.scrollTop = 40;
    applyPinchDrag({ kind: 'scroll', element: list }, { x: 0, y: 10 }, null);
    expect(list.scrollTop).toBe(30);
    applyPinchDrag({ kind: 'none' }, { x: 5, y: 5 }, { panBy });
    expect(panBy).toHaveBeenCalledTimes(1);
  });
});
