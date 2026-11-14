import { expect, test, type Page } from '@playwright/test'

import { goToChapterTimeline, openStory } from '../flows/navigation'
import { pollEntryIdOf, queryApp, queryScalar } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  seedCloseWrites,
  setProviderEndpoint,
  type SeededCloseWrites,
} from '../harness/seed'
import { chapterDelete } from '../locators/chapter-delete'
import { chapterTimeline } from '../locators/chapter-timeline'
import { chrome } from '../locators/chrome'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'

// Chapter delete (C13) from the Timeline's latest card, then a regenerate over what a close left:
// driven through the UI, asserted in the DB. See docs/testing.md → Coverage. Each describe runs on
// its own seeded launch, its tests in order on one app.
const HERO_TITLE = 'The Veilstone Courier'
// The hero story's current branch in the fixture, read from the file before launch.
const HERO_BRANCH = 'br_hero_main'
// By title, never by position: a seed change moves chapter ends (milestone C8).
const FIRST_CHAPTER = 'Nine Days of Rain'
const SECOND_CHAPTER = 'The Keep Leans Closer'
const DRAFT = 'E2E delete draft'
const KEPT_WORK_MARKER = 'E2E-DELETE-R1'
const CLOSE_MARKER = 'E2E-DELETE-R2'

type Chapter = {
  id: string
  sequenceNumber: number
  endEntryId: string
  startPosition: number
  endPosition: number
}

type Hero = { readonly app: LaunchedApp; readonly seeded: SeededCloseWrites }

// Registers its describe's launch: the hero story, its latest close given seedCloseWrites' writes.
// A narrative also installs the embedder and the mock, so the describe can regenerate.
function launchesHero(narrative?: string): () => Hero {
  let app: LaunchedApp | undefined
  let mock: MockLlm | undefined
  let seeded: SeededCloseWrites | undefined
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no reply.
    test.setTimeout(180_000)
    const dir = createSeededUserDataDir()
    userDataDir = dir.userDataDir
    seeded = seedCloseWrites(dir.dbPath, HERO_BRANCH)
    if (narrative !== undefined) {
      await installEmbedderModel(userDataDir)
      mock = await startMockLlm()
      mock.setNarrative(narrative)
      setProviderEndpoint(dir.dbPath, mock.url)
    }
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  return () => {
    if (!app || !seeded) throw new Error('the hero app has not launched')
    return { app, seeded }
  }
}

// A renamed chapter throws: an undefined id would scope every card locator to nothing.
async function chapterByTitle(page: Page, title: string): Promise<Chapter> {
  const rows = await queryApp(
    page,
    `SELECT c.id, c.sequence_number, c.end_entry_id, s.position AS startPosition, e.position AS endPosition
       FROM chapters c
       JOIN story_entries s ON s.branch_id = c.branch_id AND s.id = c.start_entry_id
       JOIN story_entries e ON e.branch_id = c.branch_id AND e.id = c.end_entry_id
      WHERE c.branch_id = ? AND c.title = ?`,
    [HERO_BRANCH, title],
  )
  if (rows.length !== 1) throw new Error(`expected one chapter titled ${title}: ${rows.length}`)
  const [id, sequenceNumber, endEntryId, startPosition, endPosition] = rows[0]
  return {
    id: id as string,
    sequenceNumber: Number(sequenceNumber),
    endEntryId: endEntryId as string,
    startPosition: Number(startPosition),
    endPosition: Number(endPosition),
  }
}

const chapterCount = (page: Page): Promise<number> =>
  queryScalar(page, `SELECT count(*) FROM chapters WHERE branch_id = ?`, [HERO_BRANCH])

const chapterRowCount = (page: Page, chapterId: string): Promise<number> =>
  queryScalar(page, `SELECT count(*) FROM chapters WHERE branch_id = ? AND id = ?`, [
    HERO_BRANCH,
    chapterId,
  ])

const entryCount = (page: Page): Promise<number> =>
  queryScalar(page, `SELECT count(*) FROM story_entries WHERE branch_id = ?`, [HERO_BRANCH])

const loreRowCount = (page: Page, loreId: string): Promise<number> =>
  queryScalar(page, `SELECT count(*) FROM lore WHERE branch_id = ? AND id = ?`, [
    HERO_BRANCH,
    loreId,
  ])

const groupDeltaCount = (page: Page, actionId: string): Promise<number> =>
  queryScalar(page, `SELECT count(*) FROM deltas WHERE branch_id = ? AND action_id = ?`, [
    HERO_BRANCH,
    actionId,
  ])

// Entries across the chapter's range that still carry a chapter.
const stampedInRange = (page: Page, chapter: Chapter): Promise<number> =>
  queryScalar(
    page,
    `SELECT count(*) FROM story_entries
      WHERE branch_id = ? AND position BETWEEN ? AND ? AND chapter_id IS NOT NULL`,
    [HERO_BRANCH, chapter.startPosition, chapter.endPosition],
  )

async function entityValue(page: Page, seeded: SeededCloseWrites): Promise<unknown> {
  const rows = await queryApp(
    page,
    `SELECT "${seeded.column}" FROM entities WHERE branch_id = ? AND id = ?`,
    [HERO_BRANCH, seeded.entityId],
  )
  return rows[0]?.[0]
}

async function headEntryId(page: Page): Promise<string | undefined> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND kind <> 'system'
      ORDER BY position DESC LIMIT 1`,
    [HERO_BRANCH],
  )
  return rows[0]?.[0] as string | undefined
}

// The head of the action row is the card's expansion: Delete… renders only once it is open.
async function expandCard(page: Page, chapterId: string): Promise<void> {
  const head = chapterTimeline.cardHead(page, chapterId)
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
}

// Rolls back to the entry after the chapter's end, read from the DB: the end reply becomes the head.
async function rollBackPastEnd(page: Page, chapter: Chapter): Promise<void> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND position > ? ORDER BY position LIMIT 1`,
    [HERO_BRANCH, chapter.endPosition],
  )
  if (rows.length !== 1) throw new Error(`no entry after chapter ${chapter.sequenceNumber}'s end`)
  const target = rows[0][0] as string
  await reader.row(page, target).scrollIntoViewIfNeeded()
  await reader.deleteEntry(page, target).click()
  await reader.rollbackConfirm(page).click()
  await expect.poll(() => headEntryId(page), { timeout: 15_000 }).toBe(chapter.endEntryId)
}

test.describe('chapter delete — the latest card only, the guard, the whole chapter', () => {
  test.describe.configure({ mode: 'serial' })
  const hero = launchesHero()
  const page = (): Page => hero().app.window
  let nine: Chapter
  let keep: Chapter
  let entriesBefore: number

  test('Delete… shows on the latest chapter’s card and not on the earlier one', async () => {
    await openStory(page(), HERO_TITLE)
    nine = await chapterByTitle(page(), FIRST_CHAPTER)
    keep = await chapterByTitle(page(), SECOND_CHAPTER)
    const { seeded } = hero()
    // The helper wrote into the latest chapter's close: this one.
    expect(seeded.endEntryId).toBe(keep.endEntryId)
    entriesBefore = await entryCount(page())
    // What the delete must change, present before it.
    expect(await stampedInRange(page(), keep)).toBeGreaterThan(0)
    expect(await loreRowCount(page(), seeded.loreId)).toBe(1)

    await goToChapterTimeline(page())
    await expandCard(page(), nine.id)
    // The earlier card's action row rendered, with no Delete… in it.
    await expect(chapterTimeline.jump(page(), nine.id)).toBeVisible()
    await expect(chapterDelete.action(page(), nine.id)).toHaveCount(0)

    await expandCard(page(), keep.id)
    await expect(chapterDelete.action(page(), keep.id)).toBeVisible()
    await expect(chapterDelete.action(page(), keep.id)).toBeEnabled()
  })

  test('a dirty card’s Delete… raises Unsaved changes; Discard opens the confirm, Cancel changes nothing', async () => {
    await chapterTimeline.field(page(), keep.id, 'title').fill(DRAFT)
    await chapterDelete.action(page(), keep.id).click()
    await expect(saveSession.unsavedDialog(page())).toBeVisible()
    await expect(chapterDelete.dialog(page())).toHaveCount(0)

    await saveSession.unsavedDiscard(page()).click()
    await expect(chapterDelete.dialog(page())).toBeVisible()
    await expect(chapterDelete.dialog(page())).toContainText(
      t('chapters:deleteConfirm.title', { number: keep.sequenceNumber }),
    )

    await chapterDelete.cancel(page()).click()
    await expect(chapterDelete.dialog(page())).toHaveCount(0)
    // The open dialog hides the card from the a11y tree, so the field is read after it closes.
    await expect(chapterTimeline.field(page(), keep.id, 'title')).toHaveValue(SECOND_CHAPTER)
    expect(await chapterCount(page())).toBe(2)
    expect(await groupDeltaCount(page(), hero().seeded.closeActionId)).toBeGreaterThan(0)
  })

  test('Delete chapter reverses the close: entries stay, stamps and lore go, the later write stands', async () => {
    const { seeded } = hero()
    await expandCard(page(), keep.id)
    await chapterDelete.action(page(), keep.id).click()
    await expect(chapterDelete.dialog(page())).toBeVisible()
    await chapterDelete.confirm(page()).click()

    await expect.poll(() => chapterCount(page()), { timeout: 15_000 }).toBe(1)
    await expect(chapterDelete.dialog(page())).toHaveCount(0)
    await expect(chapterTimeline.card(page(), keep.id)).toHaveCount(0)
    await expect(chapterTimeline.card(page(), nine.id)).toBeVisible()

    expect(await chapterRowCount(page(), nine.id)).toBe(1)
    expect(await entryCount(page())).toBe(entriesBefore)
    expect(await stampedInRange(page(), keep)).toBe(0)
    expect(await loreRowCount(page(), seeded.loreId)).toBe(0)
    expect(await entityValue(page(), seeded)).toBe(seeded.laterValue)
    expect(await groupDeltaCount(page(), seeded.closeActionId)).toBe(0)

    // The earlier chapter is the latest now: its card offers a live Delete….
    await expandCard(page(), nine.id)
    await expect(chapterDelete.action(page(), nine.id)).toBeVisible()
    await expect(chapterDelete.action(page(), nine.id)).toBeEnabled()
  })
})

test.describe('chapter delete — the divider alone, then its kept work regenerated', () => {
  test.describe.configure({ mode: 'serial' })
  const hero = launchesHero(`${KEPT_WORK_MARKER} the ledger burns before the Keep wakes.`)
  const page = (): Page => hero().app.window
  let keep: Chapter

  test('Remove divider only keeps the close’s other writes, anchored on the end entry', async () => {
    await openStory(page(), HERO_TITLE)
    keep = await chapterByTitle(page(), SECOND_CHAPTER)
    const { seeded } = hero()
    expect(seeded.endEntryId).toBe(keep.endEntryId)

    await goToChapterTimeline(page())
    await expandCard(page(), keep.id)
    await chapterDelete.action(page(), keep.id).click()
    await chapterDelete.removeDivider(page()).click()

    await expect.poll(() => chapterRowCount(page(), keep.id), { timeout: 15_000 }).toBe(0)
    await expect(chapterDelete.dialog(page())).toHaveCount(0)
    expect(await stampedInRange(page(), keep)).toBe(0)
    expect(await loreRowCount(page(), seeded.loreId)).toBe(1)
    // The divider's rows went; the seeded writes stay in the group, still on the end entry.
    expect(
      await queryScalar(
        page(),
        `SELECT count(*) FROM deltas WHERE branch_id = ? AND action_id = ?
           AND target_table IN ('chapters', 'story_entries')`,
        [HERO_BRANCH, seeded.closeActionId],
      ),
    ).toBe(0)
    expect(
      await queryApp(
        page(),
        `SELECT target_table, op, entry_id FROM deltas
          WHERE branch_id = ? AND action_id = ? AND target_id IN (?, ?) ORDER BY log_position`,
        [HERO_BRANCH, seeded.closeActionId, seeded.loreId, seeded.entityId],
      ),
    ).toEqual([
      ['lore', 'create', keep.endEntryId],
      ['entities', 'update', keep.endEntryId],
    ])
  })

  test('a rollback to the entry after the end leaves the end reply at the head', async () => {
    await chrome.back(page()).click()
    await page().waitForURL(/\/reader-composer\//)
    await expect(reader.composer(page())).toBeVisible({ timeout: 20_000 })
    await rollBackPastEnd(page(), keep)
    // The kept work is anchored on the end entry, so the rollback left it.
    expect(await loreRowCount(page(), hero().seeded.loreId)).toBe(1)
  })

  test('↻ on the end reply confirms with the kept-work copy and removes the close’s lore', async () => {
    const { seeded } = hero()
    await reader.regenEntry(page(), keep.endEntryId).click()
    await expect(reader.regenerateKeptWorkBody(page(), keep.endPosition)).toBeVisible({
      timeout: 10_000,
    })
    await expect(reader.regenerateCloseReturns(page(), keep.sequenceNumber)).toHaveCount(0)
    await reader.regenerateConfirm(page()).click()

    // The new reply committed: the sweep before it did too.
    await pollEntryIdOf(page(), HERO_BRANCH, KEPT_WORK_MARKER)
    await expect.poll(() => loreRowCount(page(), seeded.loreId), { timeout: 15_000 }).toBe(0)
    expect(await groupDeltaCount(page(), seeded.closeActionId)).toBe(0)
  })
})

test.describe('chapter delete — a close’s end reply regenerated', () => {
  test.describe.configure({ mode: 'serial' })
  const hero = launchesHero(`${CLOSE_MARKER} the Keep lets the courier pass unmarked.`)
  const page = (): Page => hero().app.window
  let keep: Chapter

  test('a rollback to the entry after the end leaves the end reply at the head', async () => {
    await openStory(page(), HERO_TITLE)
    keep = await chapterByTitle(page(), SECOND_CHAPTER)
    expect(hero().seeded.endEntryId).toBe(keep.endEntryId)
    await rollBackPastEnd(page(), keep)
    expect(await chapterRowCount(page(), keep.id)).toBe(1)
  })

  test('↻ on the end reply confirms with the close copy and removes the chapter', async () => {
    await reader.regenEntry(page(), keep.endEntryId).click()
    await expect(reader.regenerateCloseReturns(page(), keep.sequenceNumber)).toBeVisible({
      timeout: 10_000,
    })
    await expect(reader.regenerateKeptWorkBody(page(), keep.endPosition)).toHaveCount(0)
    await reader.regenerateConfirm(page()).click()

    await pollEntryIdOf(page(), HERO_BRANCH, CLOSE_MARKER)
    await expect.poll(() => chapterRowCount(page(), keep.id), { timeout: 15_000 }).toBe(0)
    expect(await stampedInRange(page(), keep)).toBe(0)
    expect(await loreRowCount(page(), hero().seeded.loreId)).toBe(0)
  })
})
