type ConnectivityListener = (online: boolean) => void;

const listeners = new Set<ConnectivityListener>();

function readOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export function getIsOnline(): boolean {
  return readOnline();
}

export function subscribeToConnectivity(listener: ConnectivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(nextOnline: boolean): void {
  for (const listener of listeners) {
    listener(nextOnline);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => notify(true));
  window.addEventListener('offline', () => notify(false));
}

export const ONLINE_REFRESH_EVENT = 'bodyexplorer:online';

export function dispatchOnlineRefreshEvent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ONLINE_REFRESH_EVENT));
}
