import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron'

import {
  exec as dbExec,
  query as dbQuery,
  transaction as dbTransaction,
  getDbFilePath,
  initDb,
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

// Shell CSP backstop for the sanitize-time exfiltration policy. connect-src
// stays open: provider calls go to arbitrary user-configured endpoints. The
// passive-fetch directives (img/font/media/object/frame) are locked so a
// sanitizer regression can't beacon out via background-image/@font-face/etc.
// Dev additionally needs unsafe-eval + inline for Metro fast refresh.
function contentSecurityPolicy(): string {
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'"
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    'connect-src *',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function applyContentSecurityPolicy(): void {
  const policy = contentSecurityPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    })
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

  // Navigation floor, mirroring the native document's nav lock: entry hrefs
  // are stripped at sanitize, so any renderer navigation away from the app's
  // own origin is hostile or a sanitize regression — block it. window.open is
  // denied outright: Electron's default child window would inherit this
  // window's webPreferences, preload (and its DB bridge) included.
  // Prefix match with a slash guard, not URL.origin: Node's URL reports the
  // origin of the custom app scheme as the literal string "null".
  const ownOrigins = [
    new URL(process.env.EXPO_WEB_URL ?? 'http://localhost:8081').origin,
    `${APP_SCHEME}://${APP_HOST}`,
  ]
  win.webContents.on('will-navigate', (event, url) => {
    const own = ownOrigins.some((origin) => url === origin || url.startsWith(`${origin}/`))
    if (!own) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (isDev) {
    win.loadURL(process.env.EXPO_WEB_URL ?? 'http://localhost:8081')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadURL(`${APP_SCHEME}://${APP_HOST}/`)
  }
}

app.whenReady().then(async () => {
  await initDb()
  applyContentSecurityPolicy()
  registerBundleProtocol()

  // electron-context-menu v4 is ESM-only; dynamic import loads it cleanly from
  // this CJS main. Attaches to all current + future windows: standard text
  // editing, copy-on-selection, and Chromium spellcheck suggestions.
  const { default: contextMenu } = await import('electron-context-menu')
  contextMenu({
    showSearchWithGoogle: false,
    showInspectElement: isDev,
  })
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
