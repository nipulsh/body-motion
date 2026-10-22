const { contextBridge, ipcRenderer } = require('electron');

function getWindowRole() {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    return params.get('window') === 'smart-mirror' ? 'smart-mirror' : 'main';
  } catch {
    return 'main';
  }
}

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  getWindowRole,
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
  openSmartMirror: (placement) => ipcRenderer.invoke('desktop:open-smart-mirror', placement),
  closeSmartMirror: () => ipcRenderer.invoke('desktop:close-smart-mirror'),
  smartMirrorIsOpen: () => ipcRenderer.invoke('desktop:smart-mirror-is-open'),
  getDisplaySnapshot: () => ipcRenderer.invoke('desktop:display-snapshot'),
  mirrorEmit: (target, event, payload) => {
    ipcRenderer.send('desktop:mirror-emit', { target, event, payload });
  },
  mirrorOn: (event, handler) => {
    const channel = `desktop:mirror-event:${event}`;
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onAuthCallback: (handler) => {
    const listener = (_event, url) => handler(url);
    ipcRenderer.on('desktop:auth-callback', listener);
    return () => ipcRenderer.removeListener('desktop:auth-callback', listener);
  },
  getPendingAuthUrls: () => ipcRenderer.invoke('desktop:get-pending-auth-urls'),
});
