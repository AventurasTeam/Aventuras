import { expect, test, type Page } from '@playwright/test'

import { openStory } from '../flows/navigation'
import { currentBranchId, queryApp, queryScalar } from '../harness/db'
import { escapeRegExp, t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { branchCreate } from '../locators/branch-create'
import { branchNavigator } from '../locators/branch-navigator'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader, undoText } from '../locators/reader'

// Creating a branch from the reader (branch-navigator.md → Branch creation — modal), UI-driven and
// DB-asserted on the hero seed (lib/db/devtools/seed-dataset.ts): two closed chapters, turns after
// the second, and a fork of its own. Entries, positions and names come from the DB, and every entry
// read names its branch: under a fork two branches share entry ids.
const HERO_STORY = 'story_hero'
const TYPED_NAME = '  Side quest  '
const STORED_NAME = 'Side quest'
const PARENT_EDIT = 'E2E-FORK-EDIT the reply was rewritten before the fork.'

type Entry = { id: string; position: number }

async function heroTitle(page: Page): Promise<string> {
  const [[title]] = await queryApp(page, `SELECT title FROM stories WHERE id = ?`, [HERO_STORY])
  return title as string
}

async function branchName(page: Page, branchId: string): Promise<string> {
  const [[name]] = await queryApp(page, `SELECT name FROM branches WHERE id = ?`, [branchId])
  return name as string
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

async function entryContent(page: Page, branchId: string, entryId: string): Promise<string> {
  const [[content]] = await queryApp(
    page,
    `SELECT content FROM story_entries WHERE branch_id = ? AND id = ?`,
    [branchId, entryId],
  )
  return content as string
}

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

  test('⎇ on a reply forks there and lands on the new branch; the parent keeps every row', async () => {
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
