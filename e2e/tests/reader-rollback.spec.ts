import { expect, test, type Page } from '@playwright/test'

import { currentBranchId, queryApp, queryScalar } from '../harness/db'
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

    const branchId = await currentBranchId(app.window, 'story_hero')
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

// By title, never by position: a seed change moves chapter ends (milestone C8).
const SECOND_CHAPTER = 'The Keep Leans Closer'

type Chapter = {
  id: string
  sequenceNumber: number
  startEntryId: string
  startPosition: number
  endPosition: number
}

// A rollback into a closed chapter: the one the target falls inside re-opens, one starting at
// or past it goes (rollback-confirm.md → Cross-chapter case). Positions come from the DB.
test.describe('reader — roll back into a closed chapter', () => {
  test.describe.configure({ mode: 'serial' })
  let app: LaunchedApp
  let userDataDir: string | undefined
  let branchId: string
  let keep: Chapter

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  async function chapterByTitle(page: Page, title: string): Promise<Chapter> {
    const rows = await queryApp(
      page,
      `SELECT c.id, c.sequence_number, c.start_entry_id, s.position AS startPosition, e.position AS endPosition
         FROM chapters c
         JOIN story_entries s ON s.branch_id = c.branch_id AND s.id = c.start_entry_id
         JOIN story_entries e ON e.branch_id = c.branch_id AND e.id = c.end_entry_id
        WHERE c.branch_id = ? AND c.title = ?`,
      [branchId, title],
    )
    if (rows.length !== 1) throw new Error(`expected one chapter titled ${title}: ${rows.length}`)
    const [id, sequenceNumber, startEntryId, startPosition, endPosition] = rows[0]
    return {
      id: id as string,
      sequenceNumber: Number(sequenceNumber),
      startEntryId: startEntryId as string,
      startPosition: Number(startPosition),
      endPosition: Number(endPosition),
    }
  }

  const count = (sql: string, params: unknown[]): Promise<number> =>
    queryScalar(app.window, sql, params)

  test('chapter 2’s start shows the removed line, and Cancel changes nothing', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    branchId = await currentBranchId(app.window, 'story_hero')
    keep = await chapterByTitle(app.window, SECOND_CHAPTER)
    const entriesBefore = await count(`SELECT count(*) FROM story_entries WHERE branch_id = ?`, [
      branchId,
    ])

    await reader.row(app.window, keep.startEntryId).scrollIntoViewIfNeeded()
    await reader.deleteEntry(app.window, keep.startEntryId).click()
    await expect(reader.rollbackChaptersRemoved(app.window, [keep.sequenceNumber])).toBeVisible()
    await expect(reader.rollbackChapterReopened(app.window, keep.sequenceNumber)).toHaveCount(0)

    await reader.rollbackCancel(app.window).click()
    await expect(reader.rollbackConfirm(app.window)).toHaveCount(0)
    expect(await count(`SELECT count(*) FROM chapters WHERE branch_id = ?`, [branchId])).toBe(2)
    expect(await count(`SELECT count(*) FROM story_entries WHERE branch_id = ?`, [branchId])).toBe(
      entriesBefore,
    )
  })

  test('a target inside chapter 2 shows the re-opened line; confirming un-stamps the entries before it', async () => {
    // Midway through the chapter, so entries of it stay below the target.
    const middle = Math.floor((keep.startPosition + keep.endPosition) / 2)
    const rows = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND position = ?`,
      [branchId, middle],
    )
    if (rows.length !== 1) throw new Error(`no entry at position ${middle}`)
    const targetId = rows[0][0] as string
    const below = `FROM story_entries WHERE branch_id = ? AND position >= ? AND position < ?`
    const belowParams = [branchId, keep.startPosition, middle]
    const entriesBelow = await count(`SELECT count(*) ${below}`, belowParams)
    expect(entriesBelow).toBeGreaterThan(0)
    expect(
      await count(`SELECT count(*) ${below} AND chapter_id = ?`, [...belowParams, keep.id]),
    ).toBe(entriesBelow)

    await reader.row(app.window, targetId).scrollIntoViewIfNeeded()
    await reader.deleteEntry(app.window, targetId).click()
    await expect(reader.rollbackChapterReopened(app.window, keep.sequenceNumber)).toBeVisible()
    await expect(reader.rollbackChaptersRemoved(app.window, [keep.sequenceNumber])).toHaveCount(0)
    await reader.rollbackConfirm(app.window).click()

    await expect
      .poll(
        () =>
          count(`SELECT count(*) FROM chapters WHERE branch_id = ? AND id = ?`, [
            branchId,
            keep.id,
          ]),
        { timeout: 15_000 },
      )
      .toBe(0)
    expect(
      await count(`SELECT count(*) FROM story_entries WHERE branch_id = ? AND position >= ?`, [
        branchId,
        middle,
      ]),
    ).toBe(0)
    // The earlier chapter is untouched: only the one the target fell inside went.
    expect(await count(`SELECT count(*) FROM chapters WHERE branch_id = ?`, [branchId])).toBe(1)
    expect(await count(`SELECT count(*) ${below}`, belowParams)).toBe(entriesBelow)
    expect(await count(`SELECT count(*) ${below} AND chapter_id IS NOT NULL`, belowParams)).toBe(0)
  })
})
