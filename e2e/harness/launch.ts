import { readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const REPO_ROOT = join(__dirname, '..', '..')
const DIST = join(REPO_ROOT, 'dist')

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

// Serve the exported web bundle with a SPA fallback. This is the local/dev
// launch mode (docs/testing.md → Launch modes): unpackaged main, renderer from
// a static dist. The packaged CI tier swaps this for the app:// protocol.
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
  const { server, origin } = await serveDist()

  const app = await electron.launch({
    args: ['electron/dist/main.js', `--user-data-dir=${opts.userDataDir}`],
    cwd: REPO_ROOT,
    env: { ...process.env, EXPO_WEB_URL: origin },
    timeout: 60_000,
  })

  // Dev-mode main opens a detached DevTools window that races the app window,
  // so firstWindow() is unreliable here — select by origin instead
  // (docs/testing.md → Launch modes).
  const isAppWindow = (page: Page) => page.url().startsWith(origin)
  let window = app.windows().find(isAppWindow)
  while (!window) {
    const page = await app.waitForEvent('window', { timeout: 30_000 })
    if (isAppWindow(page)) window = page
  }
  await window.waitForLoadState('domcontentloaded')

  const close = async () => {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (opts.cleanupUserData) await rm(opts.userDataDir, { recursive: true, force: true })
  }

  return { app, window, close }
}
