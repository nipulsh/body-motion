export const MIRROR_GESTURE_TARGET_ATTR = 'data-mirror-gesture-target';

/** Set on the topmost enabled gesture button under the hand pointer (not real mouse hover). */
export const MIRROR_HAND_HOVER_ATTR = 'data-mirror-hand-hover';

/** Marks the 3D model surface a pinch can slide and two hands can zoom. */
export const MIRROR_MODEL_ATTR = 'data-mirror-model';

/**
 * Returns the topmost enabled mirror-gesture button under the pointer, if any.
 */
export function findMirrorGestureTargetAt(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLButtonElement | null {
  const candidates = root.querySelectorAll<HTMLButtonElement>(
    `button[${MIRROR_GESTURE_TARGET_ATTR}="true"]`,
  );

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const button = candidates[i];
    if (!button || button.disabled) continue;
    const rect = button.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return button;
    }
  }

  return null;
}

/**
 * Updates which gesture button shows the hand-hover affordance.
 * Returns the hovered button, or null when the pointer is not over a target.
 */
export function syncMirrorGestureHover(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  previous: HTMLButtonElement | null,
): HTMLButtonElement | null {
  const next = findMirrorGestureTargetAt(root, clientX, clientY);
  if (previous === next) return next;
  if (previous) previous.removeAttribute(MIRROR_HAND_HOVER_ATTR);
  if (next) next.setAttribute(MIRROR_HAND_HOVER_ATTR, 'true');
  return next;
}

/** Clears hand-hover styling from every gesture button under `root`. */
export function clearMirrorGestureHover(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLButtonElement>(`button[${MIRROR_HAND_HOVER_ATTR}]`)
    .forEach((button) => button.removeAttribute(MIRROR_HAND_HOVER_ATTR));
}
