import { readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'

const REPO_ROOT = join(__dirname, '..', '..')
const DIST = join(REPO_ROOT, 'dist')

// Launch mode (docs/testing.md → Launch modes), selected by the Playwright
// project (playwright.config.ts `projects`), not an env var:
//   dev      — unpackaged main + renderer from a static dist. Fast, no
//              packaging step; the default for local authoring.
//   packaged — the electron-builder --dir binary loading app://bundle. The
//              CI target of record: exercises the app:// protocol, asar, the
//              unpacked native modules, and extraResources migrations.
type Mode = 'dev' | 'packaged'

function currentMode(): Mode {
  return test.info().project.name === 'packaged' ? 'packaged' : 'dev'
}

// Linux electron-builder --dir output.
const PACKAGED_APP = join(REPO_ROOT, 'release', 'linux-unpacked', 'aventuras')

const APP_SCHEME_ORIGIN = 'app://'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

function serveDist(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      let filePath = normalize(join(DIST, decodeURIComponent(pathname)))
      if (!filePath.startsWith(DIST)) filePath = join(DIST, 'index.html')
      try {
        const body = await readFile(filePath)
        res.writeHead(200, {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
        })
        res.end(body)
      } catch {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(await readFile(join(DIST, 'index.html')))
      }
    })()
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

// The app window is the one serving the app's own origin. In dev, main also
// opens a detached DevTools window that races it, so first-open order is
// unreliable; selecting by origin is correct in both modes.
async function selectAppWindow(app: ElectronApplication, originPrefix: string): Promise<Page> {
  const isApp = (page: Page) => page.url().startsWith(originPrefix)
  let window = app.windows().find(isApp)
  while (!window) {
    const page = await app.waitForEvent('window', { timeout: 30_000 })
    if (isApp(page)) window = page
  }
  await window.waitForLoadState('domcontentloaded')
  return window
}

export type LaunchedApp = {
  app: ElectronApplication
  window: Page
  close: () => Promise<void>
}

export async function launchApp(opts: {
  userDataDir: string
  /** Remove userDataDir on close. */
  cleanupUserData?: boolean
}): Promise<LaunchedApp> {
  const cleanupUserData = async () => {
    if (opts.cleanupUserData) await rm(opts.userDataDir, { recursive: true, force: true })
  }
  const stopServer = (server: Server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))

  if (currentMode() === 'packaged') {
    let app: ElectronApplication | undefined
    try {
      app = await electron.launch({
        executablePath: PACKAGED_APP,
        args: [`--user-data-dir=${opts.userDataDir}`],
        timeout: 60_000,
      })
      const window = await selectAppWindow(app, APP_SCHEME_ORIGIN)
      const launched = app
      return {
        app: launched,
        window,
        // finally so a failing app.close() still cleans up the temp dir.
        close: async () => {
          try {
            await launched.close()
          } finally {
            await cleanupUserData()
          }
        },
      }
    } catch (err) {
      await app?.close().catch(() => {})
      await cleanupUserData()
      throw err
    }
  }

  const { server, origin } = await serveDist()
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: ['electron/dist/main.js', `--user-data-dir=${opts.userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...process.env, EXPO_WEB_URL: origin },
      timeout: 60_000,
    })
    const window = await selectAppWindow(app, origin)
    const launched = app
    return {
      app: launched,
      window,
      // Each step runs regardless of an earlier failure — a throwing
      // app.close() must not leave the server holding the worker open.
      close: async () => {
        try {
          await launched.close()
        } finally {
          await stopServer(server)
          await cleanupUserData()
        }
      },
    }
  } catch (err) {
    await app?.close().catch(() => {})
    await stopServer(server)
    await cleanupUserData()
    throw err
  }
}
