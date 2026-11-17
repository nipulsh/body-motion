// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIRROR_GESTURE_TARGET_ATTR,
  MIRROR_HAND_HOVER_ATTR,
  clearMirrorGestureHover,
  findMirrorGestureTargetAt,
  syncMirrorGestureHover,
} from '@vision/hand/gestureTargets';

function button(left: number, top: number, width: number, height: number, disabled = false) {
  const el = document.createElement('button');
  el.setAttribute(MIRROR_GESTURE_TARGET_ATTR, 'true');
  if (disabled) el.disabled = true;
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('syncMirrorGestureHover', () => {
  it('marks the topmost enabled button under the pointer', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const back = button(10, 10, 80, 40);
    const front = button(20, 20, 80, 40);
    root.appendChild(back);
    root.appendChild(front);

    let previous: HTMLButtonElement | null = null;
    previous = syncMirrorGestureHover(root, 50, 35, previous);

    expect(previous).toBe(front);
    expect(front.getAttribute(MIRROR_HAND_HOVER_ATTR)).toBe('true');
    expect(back.hasAttribute(MIRROR_HAND_HOVER_ATTR)).toBe(false);
  });

  it('clears the previous button when the pointer moves away', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const target = button(0, 0, 100, 50);
    root.appendChild(target);

    let previous = syncMirrorGestureHover(root, 40, 20, null);
    expect(previous).toBe(target);

    previous = syncMirrorGestureHover(root, 500, 500, previous);
    expect(previous).toBeNull();
    expect(target.hasAttribute(MIRROR_HAND_HOVER_ATTR)).toBe(false);
  });

  it('does not hover disabled buttons', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const disabled = button(0, 0, 100, 50, true);
    root.appendChild(disabled);

    expect(syncMirrorGestureHover(root, 40, 20, null)).toBeNull();
    expect(findMirrorGestureTargetAt(root, 40, 20)).toBeNull();
  });

  it('clearMirrorGestureHover removes every hover marker under root', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const a = button(0, 0, 40, 40);
    const b = button(50, 0, 40, 40);
    root.appendChild(a);
    root.appendChild(b);
    a.setAttribute(MIRROR_HAND_HOVER_ATTR, 'true');
    b.setAttribute(MIRROR_HAND_HOVER_ATTR, 'true');

    clearMirrorGestureHover(root);

    expect(a.hasAttribute(MIRROR_HAND_HOVER_ATTR)).toBe(false);
    expect(b.hasAttribute(MIRROR_HAND_HOVER_ATTR)).toBe(false);
  });
});
