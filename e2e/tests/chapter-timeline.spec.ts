import { expect, test, type Page } from '@playwright/test'

import { goToChapterTimeline, openStory } from '../flows/navigation'
import { currentBranchId, queryApp } from '../harness/db'
import { escapeRegExp } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chapterTimeline } from '../locators/chapter-timeline'
import { chrome } from '../locators/chrome'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// By title, never by position: a seed change moves chapter ends (milestone C8).
const FIRST_CHAPTER = 'Nine Days of Rain'
const SECOND_CHAPTER = 'The Keep Leans Closer'
const EDITED_TITLE = 'The Keep Leans Closer, retold'
const ADDED_KEYWORD = 'e2e ledger'
const DRAFT = 'E2E dirty draft'

type Chapter = { id: string; startEntryId: string }
type Columns = { title: string; keywords: string[] }

// Serial suite, one shared app: each test starts where the last one left it. Tests 1, 2 and 4
// end on the Timeline over the reader, the rest on the reader.
test.describe.serial('Chapter Timeline', () => {
  let app: LaunchedApp
  let userDataDir: string
  let branchId: string
  let closed: number
  let nine: Chapter
  let keep: Chapter
  let keepSeeded: Columns
  let nineSeeded: Columns

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  // A renamed chapter throws: an undefined id would scope every card locator to nothing.
  async function chapterByTitle(page: Page, title: string): Promise<Chapter> {
    const rows = await queryApp(
      page,
      `SELECT id, start_entry_id FROM chapters WHERE branch_id = ? AND title = ?`,
      [branchId, title],
    )
    if (rows.length !== 1) throw new Error(`expected one chapter titled ${title}: ${rows.length}`)
    const [id, startEntryId] = rows[0]
    return { id: id as string, startEntryId: startEntryId as string }
  }

  async function columnsOf(page: Page, chapterId: string): Promise<Columns> {
    const [[title, keywords]] = await queryApp(
      page,
      `SELECT title, keywords FROM chapters WHERE branch_id = ? AND id = ?`,
      [branchId, chapterId],
    )
    return { title: title as string, keywords: JSON.parse(keywords as string) as string[] }
  }

  async function chapterUserEdits(page: Page): Promise<number> {
    const [[count]] = await queryApp(
      page,
      `SELECT count(*) FROM deltas
       WHERE branch_id = ? AND target_table = 'chapters' AND source = 'user_edit'`,
      [branchId],
    )
    return count as number
  }

  async function latestChapterUserEdit(page: Page): Promise<{ targetId: unknown; op: unknown }> {
    const [[targetId, op]] = await queryApp(
      page,
      `SELECT target_id, op FROM deltas
       WHERE branch_id = ? AND target_table = 'chapters' AND source = 'user_edit'
       ORDER BY log_position DESC LIMIT 1`,
      [branchId],
    )
    return { targetId, op }
  }

  // Answers the open Unsaved changes dialog with Discard and requires the reader in that one
  // click: a second prompt or a stuck guard keeps the page on the Timeline.
  async function discardLandsOnReader(page: Page): Promise<void> {
    const navigated = expect(
      page,
      'a second prompt or a stuck guard keeps us off the reader',
    ).toHaveURL(/\/reader-composer\//, { timeout: 15_000 })
    await saveSession.unsavedDiscard(page).click()
    await navigated
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
  }

  test('the Actions menu opens the Timeline: the closed chapters in order, then the open one', async () => {
    const page = app.window
    await openStory(page, HERO_TITLE)
    branchId = await currentBranchId(page, HERO_STORY)
    nine = await chapterByTitle(page, FIRST_CHAPTER)
    keep = await chapterByTitle(page, SECOND_CHAPTER)
    const [[count]] = await queryApp(page, `SELECT count(*) FROM chapters WHERE branch_id = ?`, [
      branchId,
    ])
    closed = count as number
    expect(closed).toBe(2)

    await goToChapterTimeline(page)
    await expect(page).toHaveURL(new RegExp(`/chapter-timeline/${escapeRegExp(branchId)}$`))
    await expect(chapterTimeline.header(page, closed)).toBeVisible()
    await expect(chapterTimeline.cardHead(page, nine.id)).toContainText(FIRST_CHAPTER)
    await expect(chapterTimeline.cardHead(page, keep.id)).toContainText(SECOND_CHAPTER)
    await expect(chapterTimeline.inProgressCard(page)).toBeVisible()
    // The rows a route opens on are hydrated ones, and expand nothing.
    await expect(chapterTimeline.cardHead(page, nine.id)).toHaveAttribute('aria-expanded', 'false')
    await expect(chapterTimeline.cardHead(page, keep.id)).toHaveAttribute('aria-expanded', 'false')

    const tops = await Promise.all(
      [
        chapterTimeline.card(page, nine.id),
        chapterTimeline.card(page, keep.id),
        chapterTimeline.inProgressCard(page),
      ].map(async (card) => (await card.boundingBox())?.y ?? Number.NaN),
    )
    expect(tops[0]).toBeLessThan(tops[1])
    expect(tops[1]).toBeLessThan(tops[2])
  })

  test('the reader popover’s Manage chapters → is live and opens the Timeline', async () => {
    const page = app.window
    await chrome.back(page).click()
    await page.waitForURL(/\/reader-composer\//)

    await reader.chapterChip(page, closed + 1).click()
    const manage = reader.popoverManage(page)
    await expect(manage).toBeVisible()
    await expect(manage).not.toHaveAttribute('aria-disabled', 'true')
    await manage.click()

    await page.waitForURL(/\/chapter-timeline\//)
    await expect(chapterTimeline.header(page, closed)).toBeVisible()
  })

  test('a title and keyword Save writes one user_edit delta, and CTRL-Z in the reader restores both', async () => {
    const page = app.window
    keepSeeded = await columnsOf(page, keep.id)
    nineSeeded = await columnsOf(page, nine.id)
    const before = await chapterUserEdits(page)

    await chapterTimeline.cardHead(page, keep.id).click()
    await expect(chapterTimeline.cardHead(page, keep.id)).toHaveAttribute('aria-expanded', 'true')
    await chapterTimeline.field(page, keep.id, 'title').fill(EDITED_TITLE)
    await chapterTimeline.keywordInput(page, keep.id).fill(ADDED_KEYWORD)
    await chapterTimeline.keywordInput(page, keep.id).press('Enter')
    await saveSession.saveBarSave(page).click()

    await expect
      .poll(() => columnsOf(page, keep.id), { timeout: 15_000 })
      .toEqual({ title: EDITED_TITLE, keywords: [...keepSeeded.keywords, ADDED_KEYWORD] })
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)
    expect(await chapterUserEdits(page)).toBe(before + 1)
    expect(await latestChapterUserEdit(page)).toEqual({ targetId: keep.id, op: 'update' })

    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.composer(page)).toBeVisible()
    // The shortcut ignores editable targets, and the composer can hold focus on return.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+z')

    await expect.poll(() => columnsOf(page, keep.id), { timeout: 15_000 }).toEqual(keepSeeded)
  })

  test('a dirty card raises Unsaved changes before another expands, before it collapses, and before a jump', async () => {
    const page = app.window
    await goToChapterTimeline(page)
    const keepHead = chapterTimeline.cardHead(page, keep.id)
    const nineHead = chapterTimeline.cardHead(page, nine.id)

    await keepHead.click()
    await chapterTimeline.field(page, keep.id, 'title').fill(DRAFT)

    // Expanding another card: Cancel keeps the dirty card open with its text.
    await nineHead.click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedCancel(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(keepHead).toHaveAttribute('aria-expanded', 'true')
    await expect(nineHead).toHaveAttribute('aria-expanded', 'false')
    await expect(chapterTimeline.field(page, keep.id, 'title')).toHaveValue(DRAFT)

    // Again: Discard drops the draft and switches.
    await nineHead.click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedDiscard(page).click()
    await expect(nineHead).toHaveAttribute('aria-expanded', 'true')
    await expect(keepHead).toHaveAttribute('aria-expanded', 'false')
    await expect(chapterTimeline.field(page, keep.id, 'title')).toHaveCount(0)
    expect(await columnsOf(page, keep.id)).toEqual(keepSeeded)

    // Collapsing the dirty card is a leave too.
    await chapterTimeline.field(page, nine.id, 'title').fill(DRAFT)
    await nineHead.click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedCancel(page).click()
    await expect(nineHead).toHaveAttribute('aria-expanded', 'true')
    await expect(chapterTimeline.field(page, nine.id, 'title')).toHaveValue(DRAFT)

    // And so is its jump.
    await chapterTimeline.jump(page, nine.id).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedCancel(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/chapter-timeline\//)

    await saveSession.saveBarDiscard(page).click()
    await expect(chapterTimeline.field(page, nine.id, 'title')).toHaveValue(FIRST_CHAPTER)
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)
  })

  // The chrome back pops through usePreventRemove: Discard must replay that pop, in one click.
  test('a dirty card’s back to the reader discards in one click', async () => {
    const page = app.window
    await expect(chapterTimeline.cardHead(page, nine.id)).toHaveAttribute('aria-expanded', 'true')
    await chapterTimeline.field(page, nine.id, 'title').fill(DRAFT)

    await chrome.back(page).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await discardLandsOnReader(page)
    expect(await columnsOf(page, nine.id)).toEqual(nineSeeded)
  })

  test('Jump to chapter → lands the reader on the chapter’s first entry', async () => {
    const page = app.window
    await goToChapterTimeline(page)
    // The reader under the Timeline still holds its tail window, without the chapter's start.
    await expect(reader.row(page, nine.startEntryId)).toHaveCount(0)

    await chapterTimeline.cardHead(page, nine.id).click()
    await chapterTimeline.jump(page, nine.id).click()

    await page.waitForURL(/\/reader-composer\//)
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(reader.row(page, nine.startEntryId)).toBeInViewport({ timeout: 20_000 })
  })

  // Jump navigates through requestLeave, which reads last render's dirty state: Discard must
  // replay the jump, in one click.
  test('a dirty card’s jump discards in one click', async () => {
    const page = app.window
    await goToChapterTimeline(page)
    await chapterTimeline.cardHead(page, keep.id).click()
    await chapterTimeline.field(page, keep.id, 'title').fill(DRAFT)

    await chapterTimeline.jump(page, keep.id).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await discardLandsOnReader(page)
    expect(await columnsOf(page, keep.id)).toEqual(keepSeeded)
  })
})
