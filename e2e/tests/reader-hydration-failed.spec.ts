import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { reader } from '../locators/reader'

// Hard navigation, not a click path — the one sanctioned hand-written URL
// (docs/testing.md → Harness structure). No in-app route can reach the reader
// with an unknown branch: both entry points (landing open, wizard finish)
// navigate only after loadOpenStory succeeds. The seam under test is the
// deep-route fallback re-booting the app on a route whose branch the DB cannot
// resolve: app://bundle → index.html in packaged mode (electron/bundle-path.ts),
// serveDist's fallback in dev.
test.describe('reader hydration failure', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('a deep route to a branch that does not exist lands on the hydration-failed state with the composer locked', async () => {
    const page = app.window
    await page.goto(new URL('/reader-composer/br_e2e_does_not_exist', page.url()).toString())

    await expect(reader.hydrationFailed(page)).toBeVisible({ timeout: 20_000 })
    // editable={false} renders as readonly on web, which is what "locked" means
    // for a TextInput — not `disabled`.
    await expect(reader.composer(page)).not.toBeEditable()

    const [[count]] = await queryApp(
      page,
      `SELECT count(*) FROM branches WHERE id = 'br_e2e_does_not_exist'`,
    )
    expect(Number(count)).toBe(0)
  })
})
