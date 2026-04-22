import { app, BrowserWindow, ipcMain, net, protocol } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const isDev = !app.isPackaged;
const APP_SCHEME = 'app';
const APP_HOST = 'bundle';

if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      allowServiceWorkers: true,
    },
  },
]);

function resolveBundlePath(urlPath: string): string {
  const distRoot = path.join(__dirname, '..', '..', 'dist');
  const rel = decodeURIComponent(urlPath) || '/';
  const normalized = rel === '/' ? '/index.html' : rel;
  const resolved = path.normalize(path.join(distRoot, normalized));
  return resolved.startsWith(distRoot) ? resolved : path.join(distRoot, 'index.html');
}

function registerBundleProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const filePath = resolveBundlePath(url.pathname);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(process.env.EXPO_WEB_URL ?? 'http://localhost:8081');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL(`${APP_SCHEME}://${APP_HOST}/`);
  }
}

app.whenReady().then(() => {
  registerBundleProtocol();
  ipcMain.handle('native:ping', () => 'pong');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
