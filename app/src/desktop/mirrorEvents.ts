import type { DesktopWindowRole } from './desktopApi';
import { getDesktopBridge, isDesktopApp } from './desktopApi';

export type MirrorEventHandler = (payload: unknown) => void;

export function mirrorEmitTo(target: DesktopWindowRole, event: string, payload: unknown): void {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  bridge.mirrorEmit(target, event, payload);
}

export function listenMirrorEvent(
  event: string,
  handler: MirrorEventHandler,
): Promise<() => void> {
  if (!isDesktopApp()) {
    return Promise.resolve(() => undefined);
  }
  const bridge = getDesktopBridge();
  if (!bridge) {
    return Promise.resolve(() => undefined);
  }
  const unlisten = bridge.mirrorOn(event, handler);
  return Promise.resolve(unlisten);
}
