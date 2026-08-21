import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import {
  CORRUPT_DRAFT_ID,
  createSeededUserDataDir,
  LOSSY_DRAFT_ID,
  removeUserDataDir,
  seedCorruptDraft,
  seedLossyDraft,
} from '../harness/seed'
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
  const CORRUPT_TITLE = 'The Unreadable Ledger'
  const LOSSY_TITLE = 'The Partial Ledger'

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    let dbPath: string
    ;({ userDataDir, dbPath } = createSeededUserDataDir())
    seedCorruptDraft(dbPath, CORRUPT_TITLE)
    seedLossyDraft(dbPath, LOSSY_TITLE)
    await installEmbedderModel(userDataDir)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  // Ordering is load-bearing: this test ends on the story list, where the
  // promotion test below starts. And a draft whose blob won't parse must NOT
  // carry its pointer into the wizard, or the fallback blank state replaces the
  // only copy on the next save — a seam only the route reaches, not a unit test.
  test('a corrupt draft saves to a new row instead of overwriting itself', async () => {
    const before = await queryApp(app.window, `SELECT state FROM wizard_sessions WHERE id = ?`, [
      CORRUPT_DRAFT_ID,
    ])
    expect(before.length, 'corrupt draft seeded').toBe(1)
    const corruptBlob = (before[0] as [string])[0]

    await home.openStory(app.window, CORRUPT_TITLE).click()
    await expect(wizard.modeOption(app.window, 'creative')).toBeVisible({ timeout: 15_000 })
    await wizard.modeOption(app.window, 'creative').click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
    await expect(wizard.opening(app.window)).toBeVisible()
    await wizard.opening(app.window).fill('A ledger nobody could read.')
    await wizard.title(app.window).fill('Recovered Ledger')
    await wizard.saveDraft(app.window).click()
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 15_000 })

    const after = await queryApp(app.window, `SELECT state FROM wizard_sessions WHERE id = ?`, [
      CORRUPT_DRAFT_ID,
    ])
    expect((after[0] as [string])[0], 'original draft blob untouched').toBe(corruptBlob)
    const original = await queryApp(app.window, `SELECT status, title FROM stories WHERE id = ?`, [
      CORRUPT_DRAFT_ID,
    ])
    expect((original[0] as [string, string])[1], 'original draft title untouched').toBe(
      CORRUPT_TITLE,
    )
    // A salvage that half-promoted the corrupt row (draft → active) would leave
    // blob and title intact and pass every other assertion here.
    expect((original[0] as [string, string])[0], 'and still a draft').toBe('draft')
    const recovered = await queryApp(app.window, `SELECT id FROM stories WHERE title = ?`, [
      'Recovered Ledger',
    ])
    expect(recovered.length, 'save minted a separate story').toBe(1)
    expect((recovered[0] as [string])[0], 'and it is not the corrupt draft').not.toBe(
      CORRUPT_DRAFT_ID,
    )
  })

  // The destructive salvage branch: a per-row loss KEEPS the draft pointer, so
  // Save replaces the row the unreadable rows still sit in — their last moment.
  // The load-time toast auto-dismisses, so the confirm is the only guard.
  test('a lossy draft confirms before Save discards the rows it could not read', async () => {
    const before = await queryApp(app.window, `SELECT state FROM wizard_sessions WHERE id = ?`, [
      LOSSY_DRAFT_ID,
    ])
    expect(before.length, 'lossy draft seeded').toBe(1)
    const lossyBlob = (before[0] as [string])[0]
    expect(lossyBlob, 'and it still holds the unreadable row').toContain('lore_unreadable')

    await home.openStory(app.window, LOSSY_TITLE).click()
    await expect(wizard.modeOption(app.window, 'creative')).toBeVisible({ timeout: 15_000 })
    await wizard.modeOption(app.window, 'creative').click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
    await expect(wizard.opening(app.window)).toBeVisible()
    await wizard.opening(app.window).fill('Half a ledger is still a ledger.')
    await wizard.title(app.window).fill('Partial Ledger Resumed')

    // Cancel first: the draft must survive a Save the user backed out of.
    await wizard.saveDraft(app.window).click()
    await expect(wizard.discardDroppedCancel(app.window)).toBeVisible({ timeout: 15_000 })
    await wizard.discardDroppedCancel(app.window).click()
    await expect(wizard.discardDroppedCancel(app.window)).toBeHidden()
    // A Save that proceeded would have routed to the list and replaced the blob.
    await expect(wizard.saveDraft(app.window)).toBeVisible()
    const afterCancel = await queryApp(
      app.window,
      `SELECT state FROM wizard_sessions WHERE id = ?`,
      [LOSSY_DRAFT_ID],
    )
    expect((afterCancel[0] as [string])[0], 'cancel wrote nothing').toBe(lossyBlob)

    // Then confirm: the same Save now lands, replacing the draft in place.
    await wizard.saveDraft(app.window).click()
    await expect(wizard.discardDroppedConfirm(app.window)).toBeVisible({ timeout: 15_000 })
    await wizard.discardDroppedConfirm(app.window).click()
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 15_000 })

    const afterSave = await queryApp(app.window, `SELECT state FROM wizard_sessions WHERE id = ?`, [
      LOSSY_DRAFT_ID,
    ])
    const savedBlob = (afterSave[0] as [string])[0]
    expect(savedBlob, 'the unreadable row is gone').not.toContain('lore_unreadable')
    expect(savedBlob, 'and the readable one survived').toContain('lore_readable')
    // In place, not a duplicate — the pointer separates this from the corrupt case.
    const rows = await queryApp(app.window, `SELECT id FROM stories WHERE title = ?`, [
      'Partial Ledger Resumed',
    ])
    expect(rows.length, 'saved into one row').toBe(1)
    expect((rows[0] as [string])[0], 'and it is the original draft').toBe(LOSSY_DRAFT_ID)
  })

  test('promotes a resumed draft on Finish without duplicating it', async () => {
    // Phase 1 — author a creative draft up to step 5, then Save as draft.
    await home.newStory(app.window).click()
    await expect(wizard.modeOption(app.window, 'creative')).toBeVisible({ timeout: 15_000 })
    await wizard.modeOption(app.window, 'creative').click()
    await wizard.next(app.window).click()
    await wizard.next(app.window).click()
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
