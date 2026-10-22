import type { MirrorWindowBounds } from '../display/mirrorWindow';
import type { DisplaySnapshot } from '../display/smartMirrorDisplay';

export type DesktopWindowRole = 'main' | 'smart-mirror';

export interface DesktopBridge {
  isElectron: true;
  getWindowRole: () => DesktopWindowRole;
  openExternal: (url: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  openSmartMirror: (placement: MirrorWindowBounds) => Promise<'created' | 'focused'>;
  closeSmartMirror: () => Promise<void>;
  smartMirrorIsOpen: () => Promise<boolean>;
  getDisplaySnapshot: () => Promise<DisplaySnapshot>;
  mirrorEmit: (target: DesktopWindowRole, event: string, payload: unknown) => void;
  mirrorOn: (event: string, handler: (payload: unknown) => void) => () => void;
  onAuthCallback: (handler: (url: string) => void) => () => void;
  getPendingAuthUrls: () => Promise<string[]>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.desktop;
  return bridge?.isElectron ? bridge : null;
}

export function isDesktopApp(): boolean {
  return getDesktopBridge() != null;
}

export function getDesktopWindowRole(): DesktopWindowRole | null {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  return bridge.getWindowRole();
}
