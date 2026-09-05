import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Edit an existing entry (common reader mutation): the inline editor commits
// through updateStoryEntryContent → the row's content changes in SQLite. No LLM
// involved. See docs/testing.md → Coverage.
const NEW_CONTENT = 'E2E-EDIT the passage was rewritten by the test.'

test.describe('reader — edit an entry', () => {
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

  test('rewrites an entry and persists the new content', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    // The most-recent ai_reply — recent, so it's inside the loaded window.
    const entryId = (
      await queryApp(
        app.window,
        `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
        [branchId],
      )
    )[0][0] as string

    const original = (
      (
        await queryApp(app.window, `SELECT content FROM story_entries WHERE id = ?`, [entryId])
      )[0] as [string]
    )[0]

    await reader.row(app.window, entryId).scrollIntoViewIfNeeded()
    await reader.editEntry(app.window, entryId).click()
    await reader.editTextarea(app.window).fill(NEW_CONTENT)
    await reader.saveEdit(app.window).click()

    const contentOf = async (): Promise<string> =>
      (
        (
          await queryApp(app.window, `SELECT content FROM story_entries WHERE id = ?`, [entryId])
        )[0] as [string]
      )[0]

    await expect.poll(contentOf, { timeout: 15_000 }).toBe(NEW_CONTENT)

    // The edit is its own undoable unit, anchored to the entry it edits.
    const edits = await queryApp(
      app.window,
      `SELECT id FROM deltas WHERE branch_id = ? AND source = 'user_edit' AND target_table = 'story_entries' AND entry_id = ?`,
      [branchId, entryId],
    )
    expect(edits).toHaveLength(1)

    const entryCount = async (): Promise<number> =>
      (
        (
          await queryApp(app.window, `SELECT COUNT(*) FROM story_entries WHERE branch_id = ?`, [
            branchId,
          ])
        )[0] as [number]
      )[0]
    const before = await entryCount()

    // The defect this guards: with no delta of its own the edit was invisible to the
    // undo target walk, so this reversed the turn and deleted its entries instead.
    await reader.actionsTrigger(app.window).click()
    await reader.undoRow(app.window).click()

    await expect.poll(contentOf, { timeout: 15_000 }).toBe(original)
    expect(await entryCount()).toBe(before)
  })
})
