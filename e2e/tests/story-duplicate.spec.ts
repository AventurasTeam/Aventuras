import { expect, test, type Locator, type Page } from '@playwright/test'

import { currentBranchId, queryApp, queryScalar } from '../harness/db'
import { escapeRegExp, t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import {
  createSeededUserDataDir,
  markSwapPending,
  otherBranchId,
  removeUserDataDir,
  setCurrentBranch,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { duplicateStory } from '../locators/duplicate-story'
import { home } from '../locators/home'
import { reader, undoText } from '../locators/reader'
import { toast } from '../locators/toast'

// story-list.md → Duplicate a story, driven from the list and read back from the DB. The
// dialog's states are Storybook's and the copy's rows unit tests' (docs/testing.md → Coverage).
const HERO_STORY = 'story_hero'
const EDITED = 'E2E-DUPLICATE-EDIT the courier rewrote this line before the copy.'
const ALL_TITLE = 'E2E Every branch of the courier'
const SWAP_TARGET = 'onnx-community/embeddinggemma-300m-ONNX'

type BranchRow = { id: string; name: string; parentId: string | null; forkEntryId: string | null }
type Source = {
  title: string
  currentId: string
  branches: BranchRow[]
  /** The card's label: max(sequence_number) + 1 on the current branch, as the list reads it. */
  chapterNumber: number
}
type Edit = { entryId: string; position: number; original: string }

async function branchesOf(page: Page, storyId: string): Promise<BranchRow[]> {
  const rows = await queryApp(
    page,
    `SELECT id, name, parent_branch_id, fork_entry_id FROM branches
      WHERE story_id = ? ORDER BY created_at, id`,
    [storyId],
  )
  return rows.map(([id, name, parentId, forkEntryId]) => ({
    id: id as string,
    name: name as string,
    parentId: (parentId as string | null) ?? null,
    forkEntryId: (forkEntryId as string | null) ?? null,
  }))
}

async function entryIds(page: Page, branchId: string): Promise<string[]> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? ORDER BY id`,
    [branchId],
  )
  return rows.map(([id]) => id as string)
}

async function entryContent(page: Page, branchId: string, entryId: string): Promise<string> {
  const [[content]] = await queryApp(
    page,
    `SELECT content FROM story_entries WHERE branch_id = ? AND id = ?`,
    [branchId, entryId],
  )
  return content as string
}

async function newestDeltaSource(page: Page, branchId: string): Promise<string> {
  const [[source]] = await queryApp(
    page,
    `SELECT source FROM deltas WHERE branch_id = ? ORDER BY log_position DESC LIMIT 1`,
    [branchId],
  )
  return source as string
}

// At most one story holds a title here; undefined until the duplicate's batch lands.
async function storyIdTitled(page: Page, title: string): Promise<string | undefined> {
  const rows = await queryApp(page, `SELECT id FROM stories WHERE title = ?`, [title])
  expect(rows.length, `stories titled ${title}`).toBeLessThanOrEqual(1)
  return rows[0]?.[0] as string | undefined
}

async function pollStoryIdTitled(page: Page, title: string): Promise<string> {
  await expect.poll(() => storyIdTitled(page, title), { timeout: 15_000 }).toBeDefined()
  const id = await storyIdTitled(page, title)
  if (id === undefined) throw new Error(`${title}: present at the poll, gone on read-back`)
  return id
}

async function readSource(page: Page): Promise<Source> {
  const [[title]] = await queryApp(page, `SELECT title FROM stories WHERE id = ?`, [HERO_STORY])
  const currentId = await currentBranchId(page, HERO_STORY)
  const branches = await branchesOf(page, HERO_STORY)
  const chapterNumber = await queryScalar(
    page,
    `SELECT max(sequence_number) + 1 FROM chapters WHERE branch_id = ?`,
    [currentId],
  )
  return { title: title as string, currentId, branches, chapterNumber }
}

function mainAndFork(source: Source): { main: BranchRow; fork: BranchRow } {
  const main = source.branches.find((b) => b.id === source.currentId)
  const fork = source.branches.find((b) => b.id !== source.currentId)
  if (main === undefined || fork === undefined)
    throw new Error(`no fork beside ${source.currentId}`)
  return { main, fork }
}

// The label sits in the card's meta line; the lookahead keeps `Chapter 3` out of `Chapter 30`.
function chapterLabel(number: number): RegExp {
  return new RegExp(`${escapeRegExp(t('chapters:label', { number }))}(?!\\d)`)
}

async function expectTopToBottom(locators: readonly Locator[], what: string): Promise<void> {
  const tops: number[] = []
  for (const locator of locators) {
    await expect(locator).toBeVisible()
    const box = await locator.boundingBox()
    if (box == null) throw new Error(`${what}: an option lays out no box`)
    tops.push(box.y)
  }
  expect(tops, what).toEqual([...tops].sort((a, b) => a - b))
}

// With the Select open: the current branch first with its mark, the other after, All branches last.
async function expectCurrentFirst(
  page: Page,
  current: BranchRow,
  other: BranchRow,
  count: number,
): Promise<void> {
  const currentMark = t('landing:duplicate.currentMark')
  await expect(duplicateStory.branchOption(page, current.name)).toContainText(currentMark)
  await expect(duplicateStory.branchOption(page, other.name)).not.toContainText(currentMark)
  await expectTopToBottom(
    [
      duplicateStory.branchOption(page, current.name),
      duplicateStory.branchOption(page, other.name),
      duplicateStory.allBranches(page, count),
    ],
    'the current branch first, All branches last',
  )
}

async function openDuplicate(page: Page, title: string): Promise<void> {
  await home.storyActionsExact(page, title).click()
  await home.duplicate(page).click()
  await expect(duplicateStory.dialog(page)).toBeVisible()
}

// Serial: each test starts on the list or the reader the one before left. A retry reruns the
// group from its first test, in a fresh launch.
test.describe.serial('story duplicate — one branch, every branch, and undo in the copy', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let source: Source
  let edit: Edit
  let allCopyCurrentId: string

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 20_000 })
    source = await readSource(app.window)
    expect(source.branches, 'the hero story holds two branches').toHaveLength(2)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test("a prose edit on the source's current branch is its newest group", async () => {
    const page = app.window
    const [[replyId, replyAt, original]] = await queryApp(
      page,
      `SELECT id, position, content FROM story_entries
        WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
      [source.currentId],
    )
    edit = { entryId: replyId as string, position: Number(replyAt), original: original as string }

    await home.openStoryExact(page, source.title).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await reader.row(page, edit.entryId).scrollIntoViewIfNeeded()
    await reader.editEntry(page, edit.entryId).click()
    await reader.editTextarea(page).fill(EDITED)
    await reader.saveEdit(page).click()
    await expect
      .poll(() => entryContent(page, source.currentId, edit.entryId), { timeout: 15_000 })
      .toBe(EDITED)
    await expect(reader.editTextarea(page)).toHaveCount(0)
    expect(await newestDeltaSource(page, source.currentId)).toBe('user_edit')

    await chrome.back(page).click()
    await expect(home.openStoryExact(page, source.title)).toBeVisible({ timeout: 10_000 })
  })

  test('Duplicate offers the DB title and branches, and copies the current branch', async () => {
    const page = app.window
    const { main, fork } = mainAndFork(source)
    const count = source.branches.length
    const copyTitle = t('landing:duplicate.nameDefault', { title: source.title })
    const storiesBefore = await queryScalar(page, `SELECT count(*) FROM stories`)

    await openDuplicate(page, source.title)
    await expect(duplicateStory.nameInput(page)).toHaveValue(copyTitle)
    await expect(duplicateStory.confirm(page)).toBeEnabled()
    await duplicateStory.branchSelect(page).click()
    await expectCurrentFirst(page, main, fork, count)
    // Esc closes the Select alone; its default, the current branch, stays picked.
    await page.keyboard.press('Escape')
    await expect(duplicateStory.allBranches(page, count)).toHaveCount(0)
    await expect(duplicateStory.dialog(page)).toBeVisible()
    await duplicateStory.confirm(page).click()

    await expect(
      toast.withText(page, t('landing:duplicate.done', { name: copyTitle })),
    ).toBeVisible()
    await expect(duplicateStory.dialog(page)).toHaveCount(0)
    const copyId = await pollStoryIdTitled(page, copyTitle)
    expect(await queryScalar(page, `SELECT count(*) FROM stories`)).toBe(storiesBefore + 1)
    const [[status, favorite, lastOpenedAt, copyCurrent]] = await queryApp(
      page,
      `SELECT status, favorite, last_opened_at, current_branch_id FROM stories WHERE id = ?`,
      [copyId],
    )
    expect({ status, favorite: Number(favorite), lastOpenedAt }).toEqual({
      status: 'active',
      favorite: 0,
      lastOpenedAt: null,
    })
    const copies = await branchesOf(page, copyId)
    expect(copies).toHaveLength(1)
    const [copy] = copies
    expect(copyCurrent).toBe(copy.id)
    expect(copy.id).not.toBe(main.id)
    expect(copy).toMatchObject({ name: main.name, parentId: null, forkEntryId: null })
    expect(await entryIds(page, copy.id)).toEqual(await entryIds(page, main.id))
    expect(await branchesOf(page, HERO_STORY)).toEqual(source.branches)

    // Read before the list loses focus: a refocus re-reads the numbers on its own.
    expect(
      source.chapterNumber,
      "the source's open chapter, past the label's default",
    ).toBeGreaterThan(1)
    const label = chapterLabel(source.chapterNumber)
    await expect(home.openStoryExact(page, source.title)).toContainText(label)
    await expect(home.openStoryExact(page, copyTitle)).toContainText(label)
  })

  test("All branches copies the tree, and the toast's Open lands on the copy", async () => {
    const page = app.window
    const { main } = mainAndFork(source)
    const count = source.branches.length
    const storiesBefore = await queryScalar(page, `SELECT count(*) FROM stories`)

    await openDuplicate(page, source.title)
    await duplicateStory.nameInput(page).fill(`  ${ALL_TITLE}  `)
    await duplicateStory.branchSelect(page).click()
    await duplicateStory.allBranches(page, count).click()
    await expect(duplicateStory.allBranches(page, count)).toHaveCount(0)
    await expect(duplicateStory.confirm(page)).toBeEnabled()
    await duplicateStory.confirm(page).click()
    // The toast dismisses itself, so Open is pressed as it shows and the DB read comes after.
    await toast
      .action(page, t('landing:duplicate.done', { name: ALL_TITLE }), t('landing:duplicate.open'))
      .click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })

    const copyId = await pollStoryIdTitled(page, ALL_TITLE)
    expect(await queryScalar(page, `SELECT count(*) FROM stories`)).toBe(storiesBefore + 1)
    allCopyCurrentId = await currentBranchId(page, copyId)
    await expect(page).toHaveURL(new RegExp(`/reader-composer/${escapeRegExp(allCopyCurrentId)}`))

    const copies = await branchesOf(page, copyId)
    expect(copies).toHaveLength(count)
    const copyByName = new Map(copies.map((b) => [b.name, b]))
    expect(copyByName.size, 'branch names tell the copies apart').toBe(count)
    const sourceById = new Map(source.branches.map((b) => [b.id, b]))
    expect(
      source.branches.some((b) => b.parentId !== null),
      'a child whose parent remaps',
    ).toBe(true)
    for (const branch of source.branches) {
      const copy = copyByName.get(branch.name)
      if (copy === undefined) throw new Error(`no copy of ${branch.name}`)
      const parent = branch.parentId === null ? undefined : sourceById.get(branch.parentId)
      expect(copy.id).not.toBe(branch.id)
      expect(copy.forkEntryId).toBe(branch.forkEntryId)
      expect(copy.parentId).toBe(parent === undefined ? null : copyByName.get(parent.name)?.id)
      expect(await entryIds(page, copy.id)).toEqual(await entryIds(page, branch.id))
    }
    expect(allCopyCurrentId).toBe(copyByName.get(main.name)?.id)
  })

  test("Undo in the copy restores the entry there and leaves the source's edit", async () => {
    const page = app.window
    expect(await newestDeltaSource(page, allCopyCurrentId), "the copy's newest group").toBe(
      'user_edit',
    )
    const deltasOnSource = () =>
      queryScalar(page, `SELECT count(*) FROM deltas WHERE branch_id = ?`, [source.currentId])
    const sourceDeltas = await deltasOnSource()

    await chrome.actionsTrigger(page).click()
    await reader.undoRow(page, undoText('menu', 'entryText', { entry: edit.position })).click()
    await expect
      .poll(() => entryContent(page, allCopyCurrentId, edit.entryId), { timeout: 15_000 })
      .toBe(edit.original)
    expect(await entryContent(page, source.currentId, edit.entryId)).toBe(EDITED)
    expect(await deltasOnSource()).toBe(sourceDeltas)
  })
})

test.describe('story duplicate — refused under a pending swap', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    markSwapPending(seeded.dbPath, HERO_STORY, SWAP_TARGET)
    // Makes current the newer branch, so creation order can't pass for the current-first order.
    setCurrentBranch(seeded.dbPath, otherBranchId(seeded.dbPath, HERO_STORY))
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('the current fork leads the Select, the swap line shows, and nothing copies', async () => {
    const page = app.window
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })
    const source = await readSource(page)
    expect(source.branches, 'the hero story holds two branches').toHaveLength(2)
    const [oldest, newest] = source.branches
    expect(newest.id, 'the current branch, newer than the other').toBe(source.currentId)
    const count = source.branches.length
    const storiesBefore = await queryScalar(page, `SELECT count(*) FROM stories`)

    await openDuplicate(page, source.title)
    await expect(duplicateStory.refusal(page, 'swapPending')).toBeVisible()
    await expect(duplicateStory.confirm(page)).toBeDisabled()
    await duplicateStory.branchSelect(page).click()
    await expectCurrentFirst(page, newest, oldest, count)
    await page.keyboard.press('Escape')
    await expect(duplicateStory.allBranches(page, count)).toHaveCount(0)
    await expect(duplicateStory.refusal(page, 'swapPending')).toBeVisible()
    await duplicateStory.nameInput(page).press('Enter')
    // A copy would land well inside this; a refusal writes nothing at all.
    await page.waitForTimeout(1_000)
    expect(await queryScalar(page, `SELECT count(*) FROM stories`)).toBe(storiesBefore)
  })
})
