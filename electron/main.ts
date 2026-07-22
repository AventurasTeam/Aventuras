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
import { deletePartial, downloadFile, persistInstall } from './embedder/downloads'
import {
  assertAllowedDownloadUrl,
  assertSafeFileName,
  assertSha256,
  modelDir,
} from './embedder/paths'
import { embed as embedderEmbed, evictPipeline, listInstalled, smokeTest } from './embedder/service'
import type { EmbedderAttestation } from './embedder/types'

// Abort handles for in-flight downloads, so a renderer cancel actually stops
// the transfer instead of only hiding its progress.
const downloadAborts = new Map<string, AbortController>()

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

// Windows whose renderer holds unsaved work, and those that have already
// answered the prompt and may close.
const closeGuards = new Set<number>()
const confirmedCloses = new Set<number>()

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
  // own origin is hostile or a sanitize regression — block it. window.open
  // never creates a child window (it would inherit this window's
  // webPreferences, preload and DB bridge included) — but https targets route
  // to the system browser: legitimate surfaces (model-card links) open
  // externally via Linking.openURL, which is window.open on react-native-web.
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Fail-open: only a renderer that has armed the guard gets asked. A renderer
  // that never armed it, or died holding it, closes normally.
  win.on('close', (event) => {
    if (!closeGuards.has(win.id) || confirmedCloses.has(win.id)) return
    event.preventDefault()
    win.webContents.send('native:close-requested')
  })
  win.on('closed', () => {
    // Window ids are reused; a stale entry here would arm the guard on an
    // unrelated future window.
    closeGuards.delete(win.id)
    confirmedCloses.delete(win.id)
  })

  if (isDev) {
    win.loadURL(process.env.EXPO_WEB_URL ?? 'http://localhost:8081')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadURL(`${APP_SCHEME}://${APP_HOST}/`)
  }
}

function requireModelDir(modelId: string): string {
  try {
    return modelDir(modelId)
  } catch (error) {
    throw new Error(
      `Invalid model id "${modelId}": ${error instanceof Error ? error.message : String(error)}`,
    )
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
  ipcMain.on('native:set-close-guard', (event, active: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win == null) return
    if (active) closeGuards.add(win.id)
    else closeGuards.delete(win.id)
  })
  ipcMain.on('native:confirm-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win == null) return
    confirmedCloses.add(win.id)
    win.close()
  })
  ipcMain.handle('db:query', (_e, sql: string, params: unknown[], method: DbProxyMethod) =>
    dbQuery(sql, params, method),
  )
  ipcMain.handle('db:exec', (_e, sql: string) => dbExec(sql))
  ipcMain.handle('db:transaction', (_e, ops: { sql: string; params: unknown[] }[]) =>
    dbTransaction(ops),
  )

  ipcMain.handle('embedder:embed', (_e, args: { modelId: string; texts: string[] }) =>
    embedderEmbed({ modelDir: requireModelDir(args.modelId), texts: args.texts }),
  )
  ipcMain.handle('embedder:smoke-test', (_e, args: { modelId: string }) =>
    smokeTest({ modelDir: requireModelDir(args.modelId) }),
  )
  ipcMain.handle('embedder:list-installed', () => listInstalled())
  ipcMain.handle(
    'embedder:download-file',
    (event, args: { url: string; modelId: string; fileName: string; expectedSha256: string }) => {
      let destDir: string
      let fileName: string
      let url: string
      let expectedSha256: string
      try {
        destDir = modelDir(args.modelId)
        fileName = assertSafeFileName(args.fileName)
        url = assertAllowedDownloadUrl(args.url)
        expectedSha256 = assertSha256(args.expectedSha256, args.fileName)
      } catch (error) {
        return {
          ok: false as const,
          reason: 'invalid-request' as const,
          message: error instanceof Error ? error.message : String(error),
        }
      }
      // One controller per model: the dialog downloads a model's files in
      // series, so a later file replaces the entry its predecessor left.
      const controller = new AbortController()
      downloadAborts.get(args.modelId)?.abort()
      downloadAborts.set(args.modelId, controller)

      return downloadFile({
        url,
        destDir,
        fileName,
        expectedSha256,
        signal: controller.signal,
        onProgress: (bytesReceived, bytesTotal) => {
          if (event.sender.isDestroyed()) return
          event.sender.send('embedder:download-progress', {
            modelId: args.modelId,
            fileName,
            bytesReceived,
            bytesTotal,
          })
        },
      }).finally(() => {
        if (downloadAborts.get(args.modelId) === controller) downloadAborts.delete(args.modelId)
      })
    },
  )
  ipcMain.handle('embedder:cancel-download', (_e, args: { modelId: string }) => {
    downloadAborts.get(args.modelId)?.abort()
  })
  ipcMain.handle(
    'embedder:persist-install',
    (_e, args: { modelId: string; licenseText: string; attestation: EmbedderAttestation }) =>
      persistInstall({
        destDir: requireModelDir(args.modelId),
        modelId: args.modelId,
        licenseText: args.licenseText,
        attestation: args.attestation,
      }),
  )
  ipcMain.handle('embedder:delete-partial', (_e, args: { modelId: string }) => {
    const dir = requireModelDir(args.modelId)
    evictPipeline(dir)
    return deletePartial(dir)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
