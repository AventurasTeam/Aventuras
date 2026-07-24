import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { wizard } from '../locators/wizard'

// The hard entry gate (wizard.md → Embedder-unavailable): with no usable
// embedder the wizard is blocked outright. This spec deliberately does NOT
// install the fixture model — the inverse of every other wizard spec — so the
// gate fires. A running app is the only place this seam (installed-list read →
// gate resolve → blocking modal) is observable. See docs/testing.md → Coverage.
test.describe('create-story wizard — embedder gate', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('blocks the wizard and commits nothing when no embedder is installed', async () => {
    const before = (await queryApp(app.window, `SELECT count(*) FROM stories`))[0] as [number]

    await home.newStory(app.window).click()

    // The gate modal lands over the shell; its title is reason-independent.
    await expect(wizard.embedGateTitle(app.window)).toBeVisible({ timeout: 15_000 })

    // Hard gate: no story is committed while it's up (the count is unchanged).
    const after = (await queryApp(app.window, `SELECT count(*) FROM stories`))[0] as [number]
    expect(after[0], 'no story created behind the gate').toBe(before[0])
  })
})
