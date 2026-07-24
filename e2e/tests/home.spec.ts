import { expect, test } from '@playwright/test'

import { FixtureDb } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'

// Spike: proves the harness end-to-end — seed a temp userData, launch the real
// Electron main against it, then assert through BOTH the DOM (i18n-resolved
// locator) and the fixture DB. The DB is the source of truth; the DOM is the
// drive surface. See docs/testing.md.
test.describe('seeded home screen', () => {
  let app: LaunchedApp
  let db: FixtureDb
  let seededUserDataDir: string

  test.beforeAll(async () => {
    const { userDataDir, dbPath } = createSeededUserDataDir()
    seededUserDataDir = userDataDir
    db = new FixtureDb(dbPath)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    db?.close()
    await app?.close()
    removeUserDataDir(seededUserDataDir)
  })

  test('renders the seeded stories that exist in the DB', async () => {
    const hero = db.get<{ title: string }>(`SELECT title FROM stories WHERE id = 'story_hero'`)
    expect(hero, 'hero story seeded').toBeDefined()

    // DOM, driven by the app's own i18n copy.
    await expect(home.openStory(app.window, hero!.title)).toBeVisible({ timeout: 15_000 })

    const storyCount = db.count('stories')
    await expect(home.listTotal(app.window, storyCount)).toBeVisible()
  })

  test('runs against the isolated seeded userData over a working DB bridge', async () => {
    // Main process resolved userData to the isolated temp dir we seeded.
    const userData = await app.app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData'),
    )
    expect(userData).toBe(seededUserDataDir)

    // The renderer's DB bridge is live, so the app is reading the seeded file
    // through the real IPC path — the seam E2E exists to cover.
    const bridgePresent = await app.window.evaluate(() =>
      Boolean((window as unknown as { aventurasDb?: unknown }).aventurasDb),
    )
    expect(bridgePresent, 'db bridge present in renderer').toBe(true)
  })
})
