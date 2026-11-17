import type { ReactNode } from 'react';
import { useSmartMirrorWindow } from '../../hooks/useSmartMirrorWindow';
import { MirrorHandNavigationLayer, MirrorHandStatusBanner } from '../smartMirror/MirrorHandNavigationLayer';
import { SmartMirrorPublisher } from '../smartMirror/SmartMirrorPublisher';
import { KioskScreenRotate } from './KioskScreenRotate';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Full-screen kiosk shell for the vertical Smart Mirror experience (no clinical sidebar).
 * Every page, the exercise session and the games included, sits on the same portrait
 * stage as the analysis page. The hand pointer stays outside it (window coordinates);
 * its hints sit inside it so they read upright.
 */
export function AppShell({ children }: AppShellProps) {
  const mirror = useSmartMirrorWindow();
  const publisher = mirror.phase === 'open' ? <SmartMirrorPublisher /> : null;

  return (
    <>
      {publisher}
      <MirrorHandNavigationLayer>
        <KioskScreenRotate>
          {children}
          <MirrorHandStatusBanner />
        </KioskScreenRotate>
      </MirrorHandNavigationLayer>
    </>
  );
}
