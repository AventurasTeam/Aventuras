import { expect, test } from '@playwright/test'

import { currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader, undoText } from '../locators/reader'
import { saveSession } from '../locators/save-session'

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

    const branchId = await currentBranchId(app.window, 'story_hero')
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
    // undo target walk, so this reversed the turn and deleted its entries instead. An open
    // editor holds undo, and the editor closes only once the commit settles.
    await expect(reader.editTextarea(app.window)).toHaveCount(0)
    const [[entryAt]] = await queryApp(
      app.window,
      `SELECT position FROM story_entries WHERE id = ?`,
      [entryId],
    )
    await chrome.actionsTrigger(app.window).click()
    await reader
      .undoRow(app.window, undoText('menu', 'entryText', { entry: entryAt as number }))
      .click()

    await expect.poll(contentOf, { timeout: 15_000 }).toBe(original)
    expect(await entryCount()).toBe(before)
  })

  // reader-composer.md → Inline edit session: Return over a dirty draft asks first, and the
  // dialog's Save is the editor's plain commit.
  test('guards Return over a dirty draft and saves through the dialog', async () => {
    // A retry relaunches the app at the story list; in order, the first test left the reader open.
    const story = home.openStory(app.window, 'The Veilstone Courier')
    await expect(reader.composer(app.window).or(story)).toBeVisible({ timeout: 20_000 })
    if (await story.isVisible()) await story.click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(app.window, 'story_hero')
    const entryId = (
      await queryApp(
        app.window,
        `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'user_action' ORDER BY position DESC LIMIT 1`,
        [branchId],
      )
    )[0][0] as string
    const contentOf = async (): Promise<string> =>
      (
        (
          await queryApp(app.window, `SELECT content FROM story_entries WHERE id = ?`, [entryId])
        )[0] as [string]
      )[0]
    const draft = 'E2E-GUARD the action was rewritten before leaving.'

    // A saved edit heads the log first: an undo of it is seen, so an unheld CTRL-Z would land at
    // once rather than open a confirm.
    const replyId = (
      await queryApp(
        app.window,
        `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
        [branchId],
      )
    )[0][0] as string
    const headEdit = 'E2E-HEAD the reply was rewritten first.'
    const replyContent = async (): Promise<string> =>
      (
        (
          await queryApp(app.window, `SELECT content FROM story_entries WHERE id = ?`, [replyId])
        )[0] as [string]
      )[0]
    await reader.row(app.window, replyId).scrollIntoViewIfNeeded()
    await reader.editEntry(app.window, replyId).click()
    await reader.editTextarea(app.window).fill(headEdit)
    await reader.saveEdit(app.window).click()
    await expect.poll(replyContent, { timeout: 15_000 }).toBe(headEdit)
    await expect(reader.editTextarea(app.window)).toHaveCount(0)

    await reader.row(app.window, entryId).scrollIntoViewIfNeeded()
    await reader.editEntry(app.window, entryId).click()
    await reader.editTextarea(app.window).fill(draft)

    // An open editor holds undo: the shortcut is refused silently, and the menu's row waits on it.
    await app.window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await app.window.keyboard.press('Control+z')
    // A seen undo commits well inside this; a silent refusal shows nothing at all.
    await app.window.waitForTimeout(1_500)
    expect(await replyContent()).toBe(headEdit)
    // Scoped to the menu's rows: the other entries' held controls carry the same reason.
    await chrome.actionsTrigger(app.window).click()
    await expect(
      app.window
        .getByRole('option')
        .getByTitle(t('reader:editFocus.held'), { exact: true })
        .first(),
    ).toBeVisible()
    await app.window.keyboard.press('Escape')
    await expect(reader.editTextarea(app.window)).toHaveValue(draft)

    await chrome.back(app.window).click()
    await expect(saveSession.unsavedDialog(app.window)).toBeVisible()
    await saveSession.unsavedCancel(app.window).click()
    await expect(saveSession.unsavedDialog(app.window)).toHaveCount(0)
    await expect(reader.editTextarea(app.window)).toHaveValue(draft)

    await chrome.back(app.window).click()
    await saveSession.unsavedSave(app.window).click()

    await expect.poll(contentOf, { timeout: 15_000 }).toBe(draft)
    await expect(reader.composer(app.window)).toHaveCount(0)
    await expect(home.openStory(app.window, 'The Veilstone Courier')).toBeVisible()
  })
})
