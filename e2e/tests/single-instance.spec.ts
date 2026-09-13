import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  exitWithin,
  launchApp,
  spawnAppProcess,
  stopAppProcess,
  type LaunchedApp,
} from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'

const windowCount = (app: LaunchedApp) =>
  app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)

// Two processes on one userData would share one DB with two in-memory stores; main's
// single-instance lock refuses the second before it opens the DB.
test.describe('single instance', () => {
  let app: LaunchedApp
  let userDataDir: string

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('a second launch on the same data directory quits cleanly and adds no window', async () => {
    const before = await windowCount(app)
    const second = spawnAppProcess(userDataDir)
    try {
      expect(await exitWithin(second.process, 20_000), second.stderr()).toEqual({
        code: 0,
        signal: null,
      })
    } finally {
      await stopAppProcess(second.process)
    }
    expect(await windowCount(app)).toBe(before)
  })

  // The lock's key is undocumented; this pins it to the data directory, which is what keeps
  // dev, an installed build and parallel E2E workers from refusing one another.
  test('a launch on another data directory is not refused', async () => {
    const otherDir = mkdtempSync(join(tmpdir(), 'aventuras-e2e-other-'))
    const other = spawnAppProcess(otherDir)
    try {
      expect(await exitWithin(other.process, 8_000), other.stderr()).toBeNull()
    } finally {
      await stopAppProcess(other.process)
      removeUserDataDir(otherDir)
    }
  })
})
