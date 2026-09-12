import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { toast } from '../locators/toast'

const HERO_TITLE = 'The Veilstone Courier'
const MISSING_BRANCH = 'br_e2e_does_not_exist'

// Hard navigation is the one sanctioned hand-written URL (docs/testing.md → Harness structure)
// — no in-app route reaches an unknown branch; both entry points navigate only after
// loadOpenStory succeeds. Tests the deep-route fallback: app://bundle → index.html (packaged,
// electron/bundle-path.ts) / serveDist's fallback (dev).
test.describe('a story that fails to open', () => {
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

  for (const route of ['reader-composer', 'world'] as const) {
    test(`a deep route into ${route} for a missing branch returns to the story list with an error toast`, async () => {
      const page = app.window
      const [[count]] = await queryApp(page, `SELECT count(*) FROM branches WHERE id = ?`, [
        MISSING_BRANCH,
      ])
      expect(Number(count)).toBe(0)

      await page.goto(new URL(`/${route}/${MISSING_BRANCH}`, page.url()).toString())

      await expect(toast.withText(page, t('reader:hydrationFailedTitle'))).toBeVisible({
        timeout: 20_000,
      })
      await expect(home.openStory(page, HERO_TITLE)).toBeVisible()
    })
  }
})
