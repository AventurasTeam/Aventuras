import { expect, test, type Page } from '@playwright/test'

import { goToWorld, openStory } from '../flows/navigation'
import { currentBranchId, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { reloadFromMain } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { reader } from '../locators/reader'
import { world } from '../locators/world'

// The strip against SQL on the seeded branch past the reader's 50-entry window, so a strip that
// reads the working set under-reports at the first assertion. Serial: each test goes on from the
// screen the last one left. See docs/testing.md → Tier 1 — assert in the database.
const STORY_ID = 'story_rich'
const STORY_TITLE = 'The Gallery of Impossible Rooms'
const ENTRIES_WINDOW = 50
// Several times the seeded reply's count, so the percent has to rise.
const EDITED_REPLY = 'E2E-STRIP-EDIT the curator rewrites the catalogue card by hand. '.repeat(30)

const OPEN_REGION = `FROM story_entries WHERE branch_id = ? AND kind != 'system' AND chapter_id IS NULL`

async function openRegionRows(page: Page, branchId: string): Promise<number> {
  const [[rows]] = await queryApp(page, `SELECT count(*) ${OPEN_REGION}`, [branchId])
  return Number(rows)
}

async function sqlPercent(page: Page, branchId: string): Promise<number> {
  const [[percent]] = await queryApp(
    page,
    `SELECT MIN(100.0, 100.0 * COALESCE(SUM(content_tokens), 0) /
       (SELECT json_extract(settings, '$.chapterTokenThreshold') FROM stories WHERE id = ?))
     ${OPEN_REGION}`,
    [STORY_ID, branchId],
  )
  return Number(percent)
}

// Bounded: an attempt that waited on an absent strip would use up toPass' whole window.
async function stripPercent(page: Page): Promise<number> {
  return Number(
    await chrome.chapterProgress(page).getAttribute('aria-valuenow', { timeout: 2_000 }),
  )
}

// Both sides re-read per attempt: the hook refetches after a write commits, so the strip trails
// SQL by a settle.
async function expectStripMatchesSql(page: Page, branchId: string): Promise<void> {
  await expect(async () => {
    expect(await stripPercent(page)).toBeCloseTo(await sqlPercent(page, branchId), 6)
  }).toPass({ timeout: 15_000 })
}

test.describe.serial('chapter progress strip', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let branchId: string

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so the failed turn needs an installed embedder. Cold
    // cache downloads ~24 MB from Hugging Face.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('reads the whole open region when the story opens', async () => {
    const page = app.window
    await openStory(page, STORY_TITLE)
    branchId = await currentBranchId(page, STORY_ID)

    // Short of the window a strip reading the store would match too, and an empty column reads 0
    // on both sides, so either would make the comparison below prove nothing.
    expect(await openRegionRows(page, branchId)).toBeGreaterThan(ENTRIES_WINDOW)
    expect(await sqlPercent(page, branchId)).toBeGreaterThan(0)

    await expectStripMatchesSql(page, branchId)
  })

  test('holds the number when a failed turn re-hydrates the reader', async () => {
    const page = app.window
    mock.failNextNarrative()
    await reader.composer(page).fill('E2E-STRIP-USER I knock on the frame of the next room.')
    await reader.send(page).click()
    await expect(reader.retrySystemEntry(page)).toBeVisible({ timeout: 30_000 })

    await expectStripMatchesSql(page, branchId)
  })

  test('holds the number across a window reload', async () => {
    const page = app.window
    const reloaded = page.waitForEvent('load')
    await reloadFromMain(app)
    await reloaded
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })

    await expectStripMatchesSql(page, branchId)
  })

  test('rises on an edit and returns on undo', async () => {
    const page = app.window
    const before = await sqlPercent(page, branchId)
    const [[replyId]] = await queryApp(
      page,
      `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
      [branchId],
    )
    const entryId = replyId as string

    await reader.row(page, entryId).scrollIntoViewIfNeeded()
    await reader.editEntry(page, entryId).click()
    await reader.editTextarea(page).fill(EDITED_REPLY)
    await reader.saveEdit(page).click()

    await expect.poll(() => sqlPercent(page, branchId), { timeout: 15_000 }).toBeGreaterThan(before)
    await expectStripMatchesSql(page, branchId)

    await chrome.actionsTrigger(page).click()
    await reader.undoRow(page).click()

    await expect.poll(() => sqlPercent(page, branchId), { timeout: 15_000 }).toBeCloseTo(before, 6)
    await expectStripMatchesSql(page, branchId)
  })

  test('shows the same value on World as in the reader', async () => {
    const page = app.window
    const inReader = await stripPercent(page)

    await goToWorld(page)
    // The reader stays mounted, hidden, under World: wait for World before reading a strip.
    await expect(world.categoryTrigger(page)).toBeVisible()

    await expect(async () => {
      expect(await stripPercent(page)).toBeCloseTo(inReader, 6)
    }).toPass({ timeout: 15_000 })
    await expectStripMatchesSql(page, branchId)
  })
})
