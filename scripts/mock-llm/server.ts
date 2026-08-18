import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { handleCompletion } from './completions'
import { createContext, type MockContext } from './context'
import { handleControl } from './control'
import { CORS_HEADERS } from './respond/wire'

const UI_PATH = join(dirname(fileURLToPath(import.meta.url)), 'ui', 'index.html')

// Only `seed/narrative` carries taggedBlockReliable in the dev seed
// (lib/db/devtools/seed-dataset.ts) and there is no capability editor in app
// settings, so it must be offered under that exact id or the piggyback fold
// silently stops firing. The second id is deliberately named for what it does:
// selecting it is how you exercise the fallback-classifier path on purpose.
const MODEL_IDS = ['seed/narrative', 'mock/no-tagged-block']

export type MockServer = {
  url: string
  uiUrl: string
  ctx: MockContext
  close: () => Promise<void>
}

export async function startMockServer(
  port: number,
  opts: { persist?: boolean } = {},
): Promise<MockServer> {
  const ctx = createContext(opts)

  const server: Server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

      // The control API is same-origin only (see control.ts); preflight is
      // answered for the OpenAI-compatible surface the app calls cross-origin.
      const isControl = pathname.startsWith('/api/')

      if (req.method === 'OPTIONS') {
        res.writeHead(204, isControl ? {} : CORS_HEADERS).end()
        return
      }

      try {
        if (pathname.endsWith('/chat/completions') && req.method === 'POST') {
          await handleCompletion(req, res, ctx)
          return
        }

        if (pathname.endsWith('/models') && req.method === 'GET') {
          res.writeHead(200, { ...CORS_HEADERS, 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              object: 'list',
              data: MODEL_IDS.map((id) => ({ id, object: 'model', owned_by: 'aventuras-mock' })),
            }),
          )
          return
        }

        if (isControl) {
          await handleControl(req, res, ctx, pathname)
          return
        }

        if (pathname === '/' || pathname === '/index.html') {
          // Read per request so editing the panel only needs a browser reload.
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(readFileSync(UI_PATH, 'utf8'))
          return
        }

        res.writeHead(404, CORS_HEADERS).end()
      } catch (err) {
        const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
        console.error('[mock-llm] request failed:', detail)
        if (!res.headersSent) {
          res.writeHead(500, {
            ...(isControl ? {} : CORS_HEADERS),
            'content-type': 'application/json',
          })
          res.end(JSON.stringify({ error: { message: detail } }))
        } else {
          res.end()
        }
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    uiUrl: `http://127.0.0.1:${address.port}/`,
    ctx,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
