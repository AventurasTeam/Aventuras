import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { wizard } from '../locators/wizard'

// The real "resume a draft" round-trip: save a draft in-app (writes the stories
// row + the wizard_sessions blob), return to the list, reopen it (hydrated from
// that blob), and Finish. The seam under test is draft *promotion* — Finish
// carries the sourceDraftId so it flips the existing row draft→active instead of
// minting a duplicate. The seed has no wizard_sessions rows, so this is driven
// entirely through the app. See docs/testing.md → Coverage.
test.describe('create-story wizard — resume a draft', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  const STORY = {
    title: 'The Tin Almanac',
    opening: 'The almanac predicted rain for a year that never came.',
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ;({ userDataDir } = createSeededUserDataDir())
    await installEmbedderModel(userDataDir)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('promotes a resumed draft on Finish without duplicating it', async () => {
    // Phase 1 — author a creative draft up to step 5, then Save as draft.
    await home.newStory(app.window).click()
    await expect(wizard.modeOption(app.window, 'creative')).toBeVisible({ timeout: 15_000 })
    await wizard.modeOption(app.window, 'creative').click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
    await expect(wizard.opening(app.window)).toBeVisible()
    await wizard.opening(app.window).fill(STORY.opening)
    await wizard.title(app.window).fill(STORY.title)
    await wizard.saveDraft(app.window).click()

    // Save-as-draft routes back to the story list.
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 15_000 })

    const draftRows = await queryApp(app.window, `SELECT status FROM stories WHERE title = ?`, [
      STORY.title,
    ])
    expect(draftRows.length, 'draft row written').toBe(1)
    expect((draftRows[0] as [string])[0]).toBe('draft')
    const totalAfterSave = (
      (await queryApp(app.window, `SELECT count(*) FROM stories`))[0] as [number]
    )[0]

    // Phase 2 — reopen the draft (same storyCard.open affordance); it hydrates
    // on the saved step (5), so Finish is immediately available.
    await home.openStory(app.window, STORY.title).click()
    await expect(wizard.finish(app.window)).toBeVisible({ timeout: 15_000 })
    await wizard.finish(app.window).click()
    await app.window.waitForURL(/\/reader-composer\//, { timeout: 30_000 })

    // Promotion, not duplication: the same row flipped to active, total unchanged.
    const finalRows = await queryApp(app.window, `SELECT status FROM stories WHERE title = ?`, [
      STORY.title,
    ])
    expect(finalRows.length, 'no duplicate story minted').toBe(1)
    expect((finalRows[0] as [string])[0]).toBe('active')
    const totalAfterFinish = (
      (await queryApp(app.window, `SELECT count(*) FROM stories`))[0] as [number]
    )[0]
    expect(totalAfterFinish, 'draft promoted in place').toBe(totalAfterSave)
  })
})
