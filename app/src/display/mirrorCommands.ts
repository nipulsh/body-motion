import { getDesktopBridge, isDesktopApp } from '../desktop/desktopApi';
import type { MirrorWindowBounds } from './mirrorWindow';

export async function openSmartMirrorWindow(bounds: MirrorWindowBounds): Promise<'created' | 'focused'> {
  if (!isDesktopApp()) {
    throw new Error('Open the desktop app to use the external Smart Mirror.');
  }
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error('Open the desktop app to use the external Smart Mirror.');
  }
  return bridge.openSmartMirror(bounds);
}

export async function closeSmartMirrorWindow(): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.closeSmartMirror();
}

export async function smartMirrorWindowIsOpen(): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  return bridge.smartMirrorIsOpen();
}
