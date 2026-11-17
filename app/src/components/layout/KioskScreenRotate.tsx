import { useLayoutEffect, type ReactNode } from 'react';
import { setKioskRotationApplied } from '../../games/gameVideoOrientation';

interface KioskScreenRotateProps {
  children: ReactNode;
  /** When false, the stage fills the landscape viewport with no rotation. */
  enabled?: boolean;
}

/**
 * Rotate the kiosk 90° left (counterclockwise) so a landscape laptop/TV
 * presents a tall portrait stage without changing OS display orientation.
 */
export function KioskScreenRotate({ children, enabled = true }: KioskScreenRotateProps) {
  useLayoutEffect(() => {
    setKioskRotationApplied(enabled);
  }, [enabled]);

  return (
    <div
      className={enabled ? 'kiosk-screen-rotate' : 'kiosk-screen-flat'}
      data-testid="kiosk-screen-rotate"
      data-rotated={enabled ? 'true' : 'false'}
    >
      {children}
    </div>
  );
}
