import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  currentMode,
  exitWithin,
  launchApp,
  spawnAppProcess,
  stopAppProcess,
} from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'

// Dev main claims this port for electron-mcp-server. Holding it stands in for a running
// `pnpm desktop` or a second suite on the same machine.
const DEV_DEVTOOLS_PORT = 9222

/** Resolves null when something else already holds the port — the same condition. */
function holdPort(port: number): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (err: NodeJS.ErrnoException) =>
      err.code === 'EADDRINUSE' ? resolve(null) : reject(err),
    )
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

test.describe('dev DevTools port', () => {
  let held: Server | null = null

  test.beforeEach(async () => {
    test.skip(currentMode() === 'packaged', 'packaged builds open no DevTools port')
    held = await holdPort(DEV_DEVTOOLS_PORT)
  })

  test.afterEach(async () => {
    const server = held
    held = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('a harness launch succeeds while the dev port is taken', async () => {
    const { userDataDir } = createSeededUserDataDir()
    const app = await launchApp({ userDataDir, cleanupUserData: true })
    await app.close()
  })

  test('a spawned dev process does not try to bind the dev port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aventuras-e2e-port-'))
    const spawned = spawnAppProcess(dir)
    try {
      expect(await exitWithin(spawned.process, 8_000), spawned.stderr()).toBeNull()
      expect(spawned.stderr()).not.toContain('Cannot start http server for devtools')
    } finally {
      await stopAppProcess(spawned.process)
      removeUserDataDir(dir)
    }
  })
})
