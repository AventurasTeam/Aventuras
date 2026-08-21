import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { corruptAppSettings, createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { recovery } from '../locators/recovery'

// app/_layout.tsx halts boot pre-Router on a corrupt app_settings row → SettingsRecoveryScreen.
// Seam: migrations → rehydrateAppSettings parse failure → gate → resetAppSettings → re-hydrate
// → Router mounts. Corruption is a test-only knob; no app route writes it.
test.describe('settings-corrupt recovery', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    corruptAppSettings(seeded.dbPath)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('an unreadable app_settings row halts boot at the recovery screen; Reset writes defaults and boots into the story list', async () => {
    const page = app.window
    await expect(recovery.title(page)).toBeVisible({ timeout: 20_000 })
    // The Router never mounted behind the gate.
    await expect(home.newStory(page)).toHaveCount(0)

    await recovery.resetSettings(page).click()

    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })
    await expect(home.openStory(page, 'The Veilstone Courier')).toBeVisible()

    // Reset rewrote the singleton to defaults (providers gone, per the copy's
    // warning) and left every story alone.
    const [[providers]] = await queryApp(
      page,
      `SELECT providers FROM app_settings WHERE id = 'singleton'`,
    )
    expect(JSON.parse(providers as string)).toEqual([])
    const [[stories]] = await queryApp(page, `SELECT count(*) FROM stories`)
    expect(Number(stories)).toBeGreaterThan(0)
  })
})
