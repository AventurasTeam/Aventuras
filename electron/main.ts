import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron'

import {
  exec as dbExec,
  getDbFilePath,
  initDb,
  query as dbQuery,
  transaction as dbTransaction,
} from './db/service'
import type { DbProxyMethod } from './db/types'

const isDev = !app.isPackaged

// Dev runs get their own userData dir (~/.config/aventuras-dev) so dev DB/cache
// never collide with an installed build, whose name comes from electron-builder.
// Must precede the first app.getPath('userData') (in initDb on whenReady).
if (isDev) app.setName('aventuras-dev')

const APP_SCHEME = 'app'
const APP_HOST = 'bundle'

if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
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
])

function resolveBundlePath(urlPath: string): string {
  const distRoot = join(__dirname, '..', '..', 'dist')
  const rel = decodeURIComponent(urlPath) || '/'
  const normalized = rel === '/' ? '/index.html' : rel
  const resolved = normalize(join(distRoot, normalized))
  return resolved.startsWith(distRoot) ? resolved : join(distRoot, 'index.html')
}

function registerBundleProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = resolveBundlePath(url.pathname)
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL(process.env.EXPO_WEB_URL ?? 'http://localhost:8081')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadURL(`${APP_SCHEME}://${APP_HOST}/`)
  }
}

app.whenReady().then(async () => {
  await initDb()
  registerBundleProtocol()
  ipcMain.handle('native:ping', () => 'pong')
  ipcMain.handle('native:reveal-db-file', () => {
    shell.showItemInFolder(getDbFilePath())
  })
  ipcMain.handle('db:query', (_e, sql: string, params: unknown[], method: DbProxyMethod) =>
    dbQuery(sql, params, method),
  )
  ipcMain.handle('db:exec', (_e, sql: string) => dbExec(sql))
  ipcMain.handle('db:transaction', (_e, ops: { sql: string; params: unknown[] }[]) =>
    dbTransaction(ops),
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
