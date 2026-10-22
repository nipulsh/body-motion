import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDisplaySnapshot, findDisplayNear, validatePlacement } from './displays.mjs';
import { startDisplaySnapshotServer } from './displaySnapshotHttp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = 'http://localhost:1420';
const isDev = process.env.ELECTRON_DEV === '1';
const AUTH_SCHEME = 'bodyexplorer';

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let mirrorWindow = null;
const pendingAuthUrls = [];

function isTrustedMediaOrigin(url) {
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.hostname === 'localhost' && parsed.port === '1420';
  } catch {
    return false;
  }
}

function configureMediaPermissions() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media' && isTrustedMediaOrigin(details.requestingUrl ?? webContents.getURL())) {
      callback(true);
      return;
    }
    callback(false);
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'media' && isTrustedMediaOrigin(requestingOrigin)) {
      return true;
    }
    return false;
  });
}

function preloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function mirrorLoadOptions() {
  if (isDev) {
    return { url: `${DEV_URL}?window=smart-mirror` };
  }
  return {
    file: path.join(__dirname, '../dist/index.html'),
    search: 'window=smart-mirror',
  };
}

function mainLoadOptions() {
  if (isDev) {
    const url = new URL(DEV_URL);
    url.searchParams.set('screen', 'mirror-home');
    return { url: url.href };
  }
  return {
    file: path.join(__dirname, '../dist/index.html'),
    search: 'screen=mirror-home',
  };
}

function loadMainWindow(win) {
  const target = mainLoadOptions();
  if (target.url) {
    return win.loadURL(target.url);
  }
  return win.loadFile(target.file, { search: target.search });
}

function loadMirrorWindow(win) {
  const target = mirrorLoadOptions();
  if (target.url) {
    return win.loadURL(target.url);
  }
  return win.loadFile(target.file, { search: target.search });
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath(),
    },
  });

  win.once('ready-to-show', () => {
    win.setFullScreen(true);
    win.show();
  });

  void loadMainWindow(win);
  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('close', () => {
    if (mirrorWindow && !mirrorWindow.isDestroyed()) {
      mirrorWindow.close();
      mirrorWindow = null;
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

function placeMirrorWindow(win, placement) {
  validatePlacement(placement);
  const display = findDisplayNear(placement.physicalX, placement.physicalY);
  win.setFullScreen(false);
  win.setBounds({
    x: Math.round(placement.x),
    y: Math.round(placement.y),
    width: Math.round(placement.width),
    height: Math.round(placement.height),
  });
  win.setBounds(display.bounds);
  win.setFullScreen(true);
}

function createMirrorWindow(placement) {
  const win = new BrowserWindow({
    title: 'Smart Mirror',
    show: true,
    frame: false,
    resizable: false,
    fullscreen: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath(),
    },
  });

  void loadMirrorWindow(win);
  placeMirrorWindow(win, placement);

  win.on('closed', () => {
    mirrorWindow = null;
  });

  return win;
}

function forwardAuthUrl(url) {
  pendingAuthUrls.push(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:auth-callback', url);
    mainWindow.focus();
  }
}

function extractAuthUrls(argv) {
  return argv.filter((arg) => arg.toLowerCase().startsWith(`${AUTH_SCHEME}:`));
}

function registerProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(AUTH_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(AUTH_SCHEME);
  }
}

function registerIpc() {
  ipcMain.handle('desktop:open-external', async (_event, url) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('desktop:close-window', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle('desktop:open-smart-mirror', async (_event, placement) => {
    if (mirrorWindow && !mirrorWindow.isDestroyed()) {
      placeMirrorWindow(mirrorWindow, placement);
      if (mirrorWindow.isMinimized()) mirrorWindow.restore();
      mirrorWindow.show();
      mirrorWindow.focus();
      return 'focused';
    }
    mirrorWindow = createMirrorWindow(placement);
    return 'created';
  });

  ipcMain.handle('desktop:close-smart-mirror', async () => {
    if (mirrorWindow && !mirrorWindow.isDestroyed()) {
      mirrorWindow.close();
      mirrorWindow = null;
    }
  });

  ipcMain.handle('desktop:smart-mirror-is-open', async () => {
    return mirrorWindow != null && !mirrorWindow.isDestroyed();
  });

  ipcMain.handle('desktop:display-snapshot', async () => buildDisplaySnapshot());

  ipcMain.handle('desktop:get-pending-auth-urls', async () => {
    const urls = pendingAuthUrls.splice(0, pendingAuthUrls.length);
    return urls;
  });

  ipcMain.on('desktop:mirror-emit', (_event, { target, event, payload }) => {
    const channel = `desktop:mirror-event:${event}`;
    if (target === 'smart-mirror' && mirrorWindow && !mirrorWindow.isDestroyed()) {
      mirrorWindow.webContents.send(channel, payload);
      return;
    }
    if (target === 'main' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    for (const url of extractAuthUrls(argv)) {
      forwardAuthUrl(url);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  registerProtocolClient();
  configureMediaPermissions();
  registerIpc();
  startDisplaySnapshotServer(buildDisplaySnapshot);

  for (const url of extractAuthUrls(process.argv)) {
    forwardAuthUrl(url);
  }

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  forwardAuthUrl(url);
});

app.on('window-all-closed', () => {
  if (mirrorWindow && !mirrorWindow.isDestroyed()) {
    mirrorWindow.close();
    mirrorWindow = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (mirrorWindow && !mirrorWindow.isDestroyed()) {
    mirrorWindow.close();
    mirrorWindow = null;
  }
});
