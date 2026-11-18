import { expect, test } from '@playwright/test'

import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'

const HERO_TITLE = 'The Veilstone Courier'

// Hand-written URL (docs/testing.md → Harness structure): Settings shows its /dev link only under
// __DEV__ (false in both launch modes), and the deep link is the seam, as Android opens dev routes.
test.describe('dev routes outside __DEV__', () => {
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

  test('a deep link into /dev lands on the Library instead', async () => {
    const page = app.window
    await expect(home.openStory(page, HERO_TITLE)).toBeVisible({ timeout: 20_000 })

    await page.goto(new URL('/dev/reseed', page.url()).toString())

    await expect(home.openStory(page, HERO_TITLE)).toBeVisible({ timeout: 20_000 })
    await expect(page).not.toHaveURL(/\/dev(\/|$)/)
  })
})
