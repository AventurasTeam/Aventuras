import { expect, test, type Page } from '@playwright/test'

import {
  closeReportAction,
  closeRunsOf,
  committedRerunAfter,
  expandChapterCard,
  LORE_TOOLS,
  loreCreateActions,
  scriptRerunLore,
  UNASKED_LANES,
} from '../flows/close-rerun'
import { goToChapterTimeline, openStory } from '../flows/navigation'
import {
  branchName,
  chapterByTitle,
  currentBranchId,
  entryContent,
  queryApp,
  queryScalar,
} from '../harness/db'
import { escapeRegExp, t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, toolLaneKey, type MockLlm } from '../harness/mock-llm'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  setChapterAutoClose,
  setProviderEndpoint,
} from '../harness/seed'
import { branchCreate } from '../locators/branch-create'
import { branchNavigator } from '../locators/branch-navigator'
import { chapterTimeline } from '../locators/chapter-timeline'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { memoryBanner } from '../locators/memory-banner'
import { reader, undoText } from '../locators/reader'
import { rerunConfirm } from '../locators/rerun-confirm'

// branch-navigator.md → Branch creation — modal, on the hero seed (lib/db/devtools/seed-dataset.ts).
// Every entry read names its branch: under a fork two branches share entry ids.
const HERO_STORY = 'story_hero'
const TYPED_NAME = '  Side quest  '
const STORED_NAME = 'Side quest'
const PARENT_EDIT = 'E2E-FORK-EDIT the reply was rewritten before the fork.'
// By title, never by position (M5 C8): the hero's latest close, with turns after it.
const RERUN_CHAPTER = 'The Keep Leans Closer'
const FORK_LORE = {
  title: 'The Ferry Toll Ledger',
  body: 'The ferrymen write down every toll the river takes.',
}

type Entry = { id: string; position: number }

async function heroTitle(page: Page): Promise<string> {
  const [[title]] = await queryApp(page, `SELECT title FROM stories WHERE id = ?`, [HERO_STORY])
  return title as string
}

const branchCount = (page: Page): Promise<number> =>
  queryScalar(page, `SELECT COUNT(*) FROM branches WHERE story_id = ?`, [HERO_STORY])

const entriesOf = (page: Page, branchId: string): Promise<unknown[][]> =>
  queryApp(
    page,
    `SELECT id, position, kind, content, chapter_id FROM story_entries
      WHERE branch_id = ? ORDER BY position`,
    [branchId],
  )

const chaptersOf = (page: Page, branchId: string): Promise<unknown[][]> =>
  queryApp(
    page,
    `SELECT id, sequence_number, start_entry_id, end_entry_id, close_report FROM chapters
      WHERE branch_id = ? ORDER BY sequence_number`,
    [branchId],
  )

async function latestReply(page: Page, branchId: string): Promise<Entry & { content: string }> {
  const [[id, position, content]] = await queryApp(
    page,
    `SELECT id, position, content FROM story_entries
      WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
    [branchId],
  )
  return { id: id as string, position: Number(position), content: content as string }
}

// The last reply before the latest close's end: a fork there drops that chapter, and the reader's
// opening slice of the hero branch holds it.
async function replyBeforeLatestCloseEnd(page: Page, branchId: string): Promise<Entry> {
  const rows = await queryApp(
    page,
    `SELECT id, position FROM story_entries
      WHERE branch_id = ? AND kind = 'ai_reply'
        AND position < (SELECT e.position FROM chapters c
                          JOIN story_entries e ON e.branch_id = c.branch_id AND e.id = c.end_entry_id
                         WHERE c.branch_id = ? ORDER BY c.sequence_number DESC LIMIT 1)
      ORDER BY position DESC LIMIT 1`,
    [branchId, branchId],
  )
  expect(rows, 'a reply before the latest close ends').toHaveLength(1)
  const [[id, position]] = rows
  return { id: id as string, position: Number(position) }
}

// The chapters a fork at `position` keeps: those whose end entry sits at or before it.
async function chaptersEndingBy(
  page: Page,
  branchId: string,
  position: number,
): Promise<unknown[]> {
  const rows = await queryApp(
    page,
    `SELECT c.id FROM chapters c
       JOIN story_entries e ON e.branch_id = c.branch_id AND e.id = c.end_entry_id
      WHERE c.branch_id = ? AND e.position <= ? ORDER BY c.sequence_number`,
    [branchId, position],
  )
  return rows.map(([id]) => id)
}

const onReader = (branchId: string): RegExp =>
  new RegExp(`/reader-composer/${escapeRegExp(branchId)}`)

// N (chapter-close.md → Re-running a close): the last non-system entry before the first one past
// the close, which is where the turns since begin.
async function forkPointAfter(page: Page, branchId: string, endPosition: number): Promise<Entry> {
  const rows = await queryApp(
    page,
    `SELECT id, position FROM story_entries
      WHERE branch_id = ? AND kind <> 'system'
        AND position < (SELECT MIN(position) FROM story_entries
                         WHERE branch_id = ? AND kind <> 'system' AND position > ?)
      ORDER BY position DESC LIMIT 1`,
    [branchId, branchId, endPosition],
  )
  expect(rows, 'an entry before the first turn past the close').toHaveLength(1)
  const [[id, position]] = rows
  return { id: id as string, position: Number(position) }
}

async function idsPastEnd(page: Page, branchId: string, endPosition: number): Promise<unknown[]> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND position > ? ORDER BY position`,
    [branchId, endPosition],
  )
  return rows.map(([id]) => id)
}

// Serial, one launch: the second test opens the story the first left on the new branch. A retry
// reruns the group from its first test, in a fresh launch.
test.describe.serial('⎇ — a branch from the reader', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let title: string
  let parentId: string
  let parentName: string
  let childId: string
  let branchTotal: number
  let edited: Entry

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('⎇ on a reply forks there and lands on the new branch; the parent keeps its entries and chapters', async () => {
    test.setTimeout(120_000)
    const page = app.window
    title = await heroTitle(page)
    await openStory(page, title)
    parentId = await currentBranchId(page, HERO_STORY)
    parentName = await branchName(page, parentId)

    // An undo on the parent leaves a Redo there, which the fork must leave in place (C6).
    const tail = await latestReply(page, parentId)
    edited = tail
    await reader.row(page, tail.id).scrollIntoViewIfNeeded()
    await reader.editEntry(page, tail.id).click()
    await reader.editTextarea(page).fill(PARENT_EDIT)
    await reader.saveEdit(page).click()
    await expect
      .poll(() => entryContent(page, parentId, tail.id), { timeout: 15_000 })
      .toBe(PARENT_EDIT)
    await expect(reader.editTextarea(page)).toHaveCount(0)
    await chrome.actionsTrigger(page).click()
    await reader.undoRow(page, undoText('menu', 'entryText', { entry: tail.position })).click()
    await expect
      .poll(() => entryContent(page, parentId, tail.id), { timeout: 15_000 })
      .toBe(tail.content)
    await chrome.actionsTrigger(page).click()
    await expect(
      reader.redoRow(page, undoText('redoMenu', 'entryText', { entry: tail.position })),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(branchNavigator.browseBranchesRow(page)).toHaveCount(0)

    const forkAt = await replyBeforeLatestCloseEnd(page, parentId)
    const parentEntries = await entriesOf(page, parentId)
    const parentChapters = await chaptersOf(page, parentId)
    const keptChapters = await chaptersEndingBy(page, parentId, forkAt.position)
    expect(parentChapters.length, 'a close ends after the fork point').toBeGreaterThan(
      keptChapters.length,
    )
    const branchesBefore = await branchCount(page)

    await reader.row(page, forkAt.id).scrollIntoViewIfNeeded()
    await reader.branchFrom(page, forkAt.id).click()
    const modal = branchCreate(page)
    await expect(modal.root).toBeVisible()
    await expect(modal.root).toContainText(
      t('reader:branches.create.context', { position: forkAt.position }),
    )
    await modal.name.fill(TYPED_NAME)
    await expect(modal.create).toBeEnabled()
    await modal.create.click()

    await expect
      .poll(() => currentBranchId(page, HERO_STORY), { timeout: 15_000 })
      .not.toBe(parentId)
    childId = await currentBranchId(page, HERO_STORY)
    await expect(page).toHaveURL(onReader(childId))
    await expect(modal.root).toHaveCount(0)
    // The reader left goes with the stack reset; then one row holds the fork entry's id.
    await expect(reader.row(page, forkAt.id)).toHaveCount(1, { timeout: 20_000 })
    // The fresh reader lands at the branch's bottom, whose last entry is the fork entry.
    await expect(reader.row(page, forkAt.id)).toBeInViewport({ timeout: 20_000 })
    branchTotal = branchesBefore + 1
    await expect(branchNavigator.chip(page, STORED_NAME, branchTotal)).toBeVisible({
      timeout: 20_000,
    })

    expect(await branchCount(page)).toBe(branchTotal)
    expect(
      await queryApp(
        page,
        `SELECT name, parent_branch_id, fork_entry_id FROM branches WHERE id = ?`,
        [childId],
      ),
      'stored trimmed, with its parent and fork entry',
    ).toEqual([[STORED_NAME, parentId, forkAt.id]])
    const childEntries = await entriesOf(page, childId)
    expect(
      childEntries.map(([id]) => id),
      "the parent's non-system entries through the fork point",
    ).toEqual(
      parentEntries
        .filter(([, position, kind]) => kind !== 'system' && Number(position) <= forkAt.position)
        .map(([id]) => id),
    )
    expect(childEntries.filter(([, , kind]) => kind === 'system')).toEqual([])
    expect(
      (await chaptersOf(page, childId)).map(([id]) => id),
      'no chapter on the child ends after the fork point',
    ).toEqual(keptChapters)
    expect(await entriesOf(page, parentId), "the parent's entries").toEqual(parentEntries)
    expect(await chaptersOf(page, parentId), "the parent's chapters").toEqual(parentChapters)

    await chrome.back(page).click()
    await expect(home.openStory(page, title)).toBeVisible({ timeout: 10_000 })
    await expect(reader.composer(page)).toHaveCount(0)
  })

  test('Redo stays with the parent: absent on the new branch, back after switching to the parent', async () => {
    const page = app.window
    await openStory(page, title)
    expect(await currentBranchId(page, HERO_STORY)).toBe(childId)
    await expect(page).toHaveURL(onReader(childId))
    await chrome.actionsTrigger(page).click()
    await expect(branchNavigator.browseBranchesRow(page)).toBeVisible()
    await expect(reader.anyRedoRow(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(branchNavigator.browseBranchesRow(page)).toHaveCount(0)

    await branchNavigator.chip(page, STORED_NAME, branchTotal).click()
    await branchNavigator.row(page, parentName).click()
    await expect.poll(() => currentBranchId(page, HERO_STORY), { timeout: 15_000 }).toBe(parentId)
    await expect(page).toHaveURL(onReader(parentId))
    await chrome.actionsTrigger(page).click()
    await expect(
      reader.redoRow(page, undoText('redoMenu', 'entryText', { entry: edited.position })),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(branchNavigator.browseBranchesRow(page)).toHaveCount(0)
  })
})

// Its own launch: the fork moves the story's current branch, and the re-run needs the mock.
test.describe('Re-run on new branch — from the Chapter Timeline', () => {
  let app: LaunchedApp | undefined
  let mock: MockLlm | undefined
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    // A re-run refuses while a close is owed; auto-close off keeps the region out of it.
    setChapterAutoClose(seeded.dbPath, HERO_STORY, false)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('forks where the turns since begin and re-runs the close there; the parent keeps its turns', async () => {
    test.setTimeout(180_000)
    if (!app || !mock) throw new Error('the app or the mock never started')
    const page = app.window
    const llm = mock
    const loreLane = toolLaneKey(LORE_TOOLS)
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })
    const title = await heroTitle(page)
    await openStory(page, title)
    const parentId = await currentBranchId(page, HERO_STORY)
    const parentName = await branchName(page, parentId)
    const chapter = await chapterByTitle(page, parentId, RERUN_CHAPTER)
    const forkPoint = await forkPointAfter(page, parentId, chapter.endPosition)
    const autoName = t('chapters:rerunConfirm.autoName', { number: chapter.sequenceNumber })
    const parentPastEnd = await idsPastEnd(page, parentId, chapter.endPosition)
    expect(parentPastEnd.length, 'turns followed the close').toBeGreaterThan(0)
    const closeAction = await closeReportAction(page, parentId, chapter.id)
    if (typeof closeAction !== 'string') throw new Error('the latest close wrote no report')
    const branchesBefore = await branchCount(page)

    scriptRerunLore(llm, FORK_LORE)
    await goToChapterTimeline(page)
    await expandChapterCard(page, chapter.id)
    await expect(chapterTimeline.rerunClose(page, chapter.id)).toBeEnabled()
    await chapterTimeline.rerunClose(page, chapter.id).click()
    const confirm = rerunConfirm(page)
    await expect(confirm.root).toBeVisible()
    // The preview's N is the DB's.
    await expect(confirm.root).toContainText(
      t('chapters:rerunConfirm.forkSentence', {
        branch: parentName,
        position: forkPoint.position,
        name: autoName,
      }),
    )
    await expect(confirm.rerunOnBranch).toBeEnabled()

    const runsBefore = (await closeRunsOf(page, HERO_STORY)).length
    const requestsBefore = llm.requests.length
    // Held mid-re-run, so the running banner can be read on the new branch's reader.
    llm.holdNextStructured(loreLane)
    try {
      await confirm.rerunOnBranch.click()
      await expect
        .poll(() => llm.requests.slice(requestsBefore).some((r) => r.agent === loreLane), {
          timeout: 60_000,
          message: "the re-run never reached Lore's call",
        })
        .toBe(true)
      await expect(confirm.root).toHaveCount(0)
      await expect(page).toHaveURL(/\/reader-composer\//)
      await expect(page).not.toHaveURL(onReader(parentId))
      await expect(memoryBanner.closingTask(page, 'lore')).toBeVisible()
    } finally {
      llm.releaseStructured()
    }

    const childId = await currentBranchId(page, HERO_STORY)
    expect(childId, 'the pointer names the new branch').not.toBe(parentId)
    await expect(page).toHaveURL(onReader(childId))
    expect(await branchCount(page)).toBe(branchesBefore + 1)
    expect(
      await queryApp(
        page,
        `SELECT name, parent_branch_id, fork_entry_id FROM branches WHERE id = ?`,
        [childId],
      ),
      'the auto-name, the parent and N',
    ).toEqual([[autoName, parentId, forkPoint.id]])

    const rerun = await committedRerunAfter(page, HERO_STORY, runsBefore, closeAction)
    await expect(memoryBanner.rerun(page, chapter.sequenceNumber)).toBeVisible()
    await expect(branchNavigator.chip(page, autoName, branchesBefore + 1)).toBeVisible()
    expect(
      await idsPastEnd(page, childId, chapter.endPosition),
      'the child holds no turn past the close',
    ).toEqual([])
    expect(await closeReportAction(page, childId, chapter.id), "the child's report").toBe(rerun)
    expect(await loreCreateActions(page, childId, FORK_LORE.title)).toEqual([[rerun]])
    const asked = llm.requests.slice(requestsBefore).map((request) => request.agent)
    for (const lane of UNASKED_LANES) expect(asked).not.toContain(lane)

    expect(await idsPastEnd(page, parentId, chapter.endPosition), "the parent's turns").toEqual(
      parentPastEnd,
    )
    expect(await closeReportAction(page, parentId, chapter.id), "the parent's report").toBe(
      closeAction,
    )
    expect(await loreCreateActions(page, parentId, FORK_LORE.title)).toEqual([])

    await chrome.back(page).click()
    await expect(home.openStory(page, title)).toBeVisible({ timeout: 10_000 })
    await expect(reader.composer(page)).toHaveCount(0)

    mock = undefined
    await expect(llm.close(), 'every scripted step was taken').resolves.toBeUndefined()
  })
})
