import type { ReactNode } from 'react';
import { useSmartMirrorWindow } from '../../hooks/useSmartMirrorWindow';
import { MirrorHandNavigationLayer } from '../smartMirror/MirrorHandNavigationLayer';
import { SmartMirrorPublisher } from '../smartMirror/SmartMirrorPublisher';
import { KioskScreenRotate } from './KioskScreenRotate';

interface AppShellProps {
  children: ReactNode;
  /** Portrait rotation. The live exercise session turns this off. */
  rotate?: boolean;
}

/**
 * Full-screen kiosk shell for the vertical Smart Mirror experience (no clinical sidebar).
 */
export function AppShell({ children, rotate = true }: AppShellProps) {
  const mirror = useSmartMirrorWindow();
  const publisher = mirror.phase === 'open' ? <SmartMirrorPublisher /> : null;

  return (
    <>
      {publisher}
      <MirrorHandNavigationLayer>
        <KioskScreenRotate enabled={rotate}>{children}</KioskScreenRotate>
      </MirrorHandNavigationLayer>
    </>
  );
}
