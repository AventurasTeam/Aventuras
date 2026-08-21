import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { reader } from '../locators/reader'

// Hard navigation is the one sanctioned hand-written URL (docs/testing.md → Harness structure)
// — no in-app route reaches an unknown branch; both entry points navigate only after
// loadOpenStory succeeds. Tests the deep-route fallback: app://bundle → index.html (packaged,
// electron/bundle-path.ts) / serveDist's fallback (dev).
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
    // editable={false} renders as readonly on web — "locked" means that, not `disabled`.
    await expect(reader.composer(page)).not.toBeEditable()

    const [[count]] = await queryApp(
      page,
      `SELECT count(*) FROM branches WHERE id = 'br_e2e_does_not_exist'`,
    )
    expect(Number(count)).toBe(0)
  })
})
