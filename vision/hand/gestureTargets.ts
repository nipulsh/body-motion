export const MIRROR_GESTURE_TARGET_ATTR = 'data-mirror-gesture-target';

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
