import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Roll back (delete-to-entry), a common reader mutation: deleting an entry
// removes it and every entry after it on the branch. Confirmed through the
// modal, asserted by position in the DB. No LLM involved. See
// docs/testing.md → Coverage.
test.describe('reader — roll back to an entry', () => {
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

  test('deleting an entry removes it and all entries after it', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    // Third from the tail: recent enough to be in the loaded window, with two
    // successors to prove the cascade.
    const tail = await queryApp(
      app.window,
      `SELECT id, position FROM story_entries WHERE branch_id = ? ORDER BY position DESC LIMIT 3`,
      [branchId],
    )
    const [targetId, targetPos] = tail[2] as [string, number]

    await reader.row(app.window, targetId).scrollIntoViewIfNeeded()
    await reader.deleteEntry(app.window, targetId).click()
    await reader.rollbackConfirm(app.window).click()

    // Everything at or after the target is gone.
    await expect
      .poll(
        async () =>
          (
            (
              await queryApp(
                app.window,
                `SELECT count(*) FROM story_entries WHERE branch_id = ? AND position >= ?`,
                [branchId, targetPos],
              )
            )[0] as [number]
          )[0],
        { timeout: 15_000 },
      )
      .toBe(0)
  })
})
