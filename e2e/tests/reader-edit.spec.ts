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

    await reader.row(app.window, entryId).scrollIntoViewIfNeeded()
    await reader.editEntry(app.window, entryId).click()
    await reader.editTextarea(app.window).fill(NEW_CONTENT)
    await reader.saveEdit(app.window).click()

    await expect
      .poll(
        async () =>
          (
            (
              await queryApp(app.window, `SELECT content FROM story_entries WHERE id = ?`, [
                entryId,
              ])
            )[0] as [string]
          )[0],
        { timeout: 15_000 },
      )
      .toBe(NEW_CONTENT)
  })
})
