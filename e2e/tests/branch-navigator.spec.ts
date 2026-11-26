import { expect, test, type Page } from '@playwright/test'

import { branchName, currentBranchId, entryContent, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { escapeRegExp, t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { branchNavigator } from '../locators/branch-navigator'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader, undoText } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { storySettings } from '../locators/story-settings'

// branch-navigator.md → Per-row anatomy. Only what a running router shows is here; the rest is in
// unit tests and Storybook (docs/testing.md → Coverage). The seed's fork takes no turn (C7).
const HERO_STORY = 'story_hero'
const MAIN_EDIT = 'E2E-BRANCH-EDIT the reply was rewritten before the switch.'
const COMPOSER_DRAFT = 'E2E-BRANCH-DRAFT the courier hesitates at the fork.'
const EDITOR_DRAFT = 'E2E-BRANCH-GUARD the passage was rewritten and left unsaved.'
const RENAMED = 'E2E Renamed fork'
const ESCAPED_NAME = 'E2E Name that Esc drops'
const HELD_ACTION = 'E2E-BRANCH-HELD I wait at the crossroads.'
const PAUSED_NAME = 'E2E Renamed under a run'

type BranchFacts = { id: string; name: string; tailId: string }
type Hero = { title: string; main: BranchFacts; fork: BranchFacts }
type EmptyPaintWatch = { seen: boolean; insertions: number; observer: MutationObserver }
type WatchedWindow = Window & { __e2eEmptyPaint?: EmptyPaintWatch }

async function tailIdOf(page: Page, branchId: string): Promise<string> {
  const [[id]] = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? ORDER BY position DESC LIMIT 1`,
    [branchId],
  )
  return id as string
}

// The branch the story points at on launch is `main`; the story's one other branch is the fork.
async function readHero(page: Page): Promise<Hero> {
  const [[title]] = await queryApp(page, `SELECT title FROM stories WHERE id = ?`, [HERO_STORY])
  const currentId = await currentBranchId(page, HERO_STORY)
  const rows = await queryApp(
    page,
    `SELECT id, name FROM branches WHERE story_id = ? ORDER BY created_at, id`,
    [HERO_STORY],
  )
  expect(rows, 'the hero story holds two branches').toHaveLength(2)
  const branches: BranchFacts[] = []
  for (const [id, name] of rows) {
    branches.push({
      id: id as string,
      name: name as string,
      tailId: await tailIdOf(page, id as string),
    })
  }
  const main = branches.find((b) => b.id === currentId)
  const fork = branches.find((b) => b.id !== currentId)
  if (main === undefined || fork === undefined) throw new Error(`no fork beside ${currentId}`)
  return { title: title as string, main, fork }
}

async function openStoryNamed(page: Page, title: string): Promise<void> {
  await home.openStory(page, title).click()
  await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
}

async function expectOnBranch(page: Page, branch: BranchFacts): Promise<void> {
  await expect.poll(() => currentBranchId(page, HERO_STORY), { timeout: 15_000 }).toBe(branch.id)
  await expect(page).toHaveURL(new RegExp(`/reader-composer/${escapeRegExp(branch.id)}`))
  await expect(reader.row(page, branch.tailId)).toBeVisible({ timeout: 20_000 })
}

// Installed before a switch: the reader being left, rendering its empty placeholder over the new
// branch's stores for even one commit, inserts this text where no locator could catch it.
async function watchEmptyPaint(page: Page): Promise<void> {
  await page.evaluate((needle) => {
    const w = window as WatchedWindow
    w.__e2eEmptyPaint?.observer.disconnect()
    const watch: EmptyPaintWatch = {
      seen: false,
      insertions: 0,
      observer: new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData' && record.target.textContent?.includes(needle))
            watch.seen = true
          for (const node of Array.from(record.addedNodes)) {
            watch.insertions += 1
            if (node.textContent?.includes(needle)) watch.seen = true
          }
        }
      }),
    }
    watch.observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    w.__e2eEmptyPaint = watch
  }, t('reader:emptyTitle'))
}

async function expectNoEmptyPaint(page: Page): Promise<void> {
  const paint = await page.evaluate(() => {
    const watch = (window as WatchedWindow).__e2eEmptyPaint
    watch?.observer.disconnect()
    return { seen: watch?.seen ?? false, insertions: watch?.insertions ?? 0 }
  })
  // Insertions read back prove the watch attached and outlived the switch (a reload drops it).
  expect(paint.insertions, 'nodes the observer saw inserted').toBeGreaterThan(0)
  expect(paint.seen, 'the reader left painted its empty state').toBe(false)
}

async function switchTo(page: Page, from: BranchFacts, to: BranchFacts): Promise<void> {
  const chip = branchNavigator.chip(page, from.name, 2)
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await watchEmptyPaint(page)
  await chip.click()
  await branchNavigator.row(page, to.name).click()
  await expectOnBranch(page, to)
  await expectNoEmptyPaint(page)
}

async function expectRowOrder(page: Page, names: readonly string[]): Promise<void> {
  const tops: number[] = []
  for (const name of names) {
    const row = branchNavigator.row(page, name)
    await expect(row).toBeVisible()
    const box = await row.boundingBox()
    if (box == null) throw new Error(`the navigator lays out no row named ${name}`)
    tops.push(box.y)
  }
  expect(tops, `rows top to bottom: ${names.join(', ')}`).toEqual([...tops].sort((a, b) => a - b))
}

// Serial: each test starts where the one before left the reader, and the fork's name the rename
// test wrote carries forward. A retry reruns the group from its first test, in a fresh launch.
test.describe.serial('branch navigator — switching, rename and the pointer', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let hero: Hero

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 20_000 })
    hero = await readHero(app.window)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('the chip names the current branch, and the navigator lists it first', async () => {
    const page = app.window
    await openStoryNamed(page, hero.title)
    const chip = branchNavigator.chip(page, hero.main.name, 2)
    await expect(chip).toBeVisible({ timeout: 20_000 })
    await expect(chip).toContainText('2')
    await chip.click()
    await expect(branchNavigator.title(page, 2)).toBeVisible()
    await expectRowOrder(page, [hero.main.name, hero.fork.name])
    await page.keyboard.press('Escape')
    await expect(branchNavigator.navigator(page)).toHaveCount(0)
  })

  test('a switch lands a fresh reader on the fork, and Redo stays with its branch', async () => {
    const page = app.window
    const { main, fork } = hero
    const [[replyId, replyAt, original]] = await queryApp(
      page,
      `SELECT id, position, content FROM story_entries
        WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
      [main.id],
    )
    const entryId = replyId as string
    const entry = Number(replyAt)
    await reader.row(page, entryId).scrollIntoViewIfNeeded()
    await reader.editEntry(page, entryId).click()
    await reader.editTextarea(page).fill(MAIN_EDIT)
    await reader.saveEdit(page).click()
    await expect
      .poll(() => entryContent(page, main.id, entryId), { timeout: 15_000 })
      .toBe(MAIN_EDIT)
    await expect(reader.editTextarea(page)).toHaveCount(0)
    await chrome.actionsTrigger(page).click()
    await reader.undoRow(page, undoText('menu', 'entryText', { entry })).click()
    await expect
      .poll(() => entryContent(page, main.id, entryId), { timeout: 15_000 })
      .toBe(original as string)

    await switchTo(page, main, fork)
    await chrome.actionsTrigger(page).click()
    await expect(branchNavigator.browseBranchesRow(page)).toBeVisible()
    await expect(reader.anyRedoRow(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(branchNavigator.browseBranchesRow(page)).toHaveCount(0)

    await switchTo(page, fork, main)
    await chrome.actionsTrigger(page).click()
    await expect(reader.redoRow(page, undoText('redoMenu', 'entryText', { entry }))).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(branchNavigator.browseBranchesRow(page)).toHaveCount(0)
  })

  test("the composer's text stays behind, nothing prompts, and the current branch leads", async () => {
    const page = app.window
    const { main, fork } = hero
    await reader.composer(page).fill(COMPOSER_DRAFT)
    await switchTo(page, main, fork)
    await expect(reader.composer(page)).toHaveValue('')
    await expect(chrome.anyAlertDialog(page)).toHaveCount(0)

    await branchNavigator.chip(page, fork.name, 2).click()
    await expect(branchNavigator.title(page, 2)).toBeVisible()
    await expectRowOrder(page, [fork.name, main.name])
    await page.keyboard.press('Escape')
    await expect(branchNavigator.navigator(page)).toHaveCount(0)
  })

  test('a dirty inline editor guards the switch: Cancel stays, Discard switches', async () => {
    const page = app.window
    const { main, fork } = hero
    const [[targetId, original]] = await queryApp(
      page,
      `SELECT id, content FROM story_entries
        WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
      [fork.id],
    )
    const entryId = targetId as string
    await reader.row(page, entryId).scrollIntoViewIfNeeded()
    await reader.editEntry(page, entryId).click()
    await reader.editTextarea(page).fill(EDITOR_DRAFT)

    await branchNavigator.chip(page, fork.name, 2).click()
    await branchNavigator.row(page, main.name).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    // The switch waits on the guard's answer: nothing is written while it asks.
    expect(await currentBranchId(page, HERO_STORY)).toBe(fork.id)
    await saveSession.unsavedCancel(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    expect(await currentBranchId(page, HERO_STORY)).toBe(fork.id)
    await expect(reader.editTextarea(page)).toHaveValue(EDITOR_DRAFT)

    await watchEmptyPaint(page)
    await branchNavigator.chip(page, fork.name, 2).click()
    await branchNavigator.row(page, main.name).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    expect(await currentBranchId(page, HERO_STORY)).toBe(fork.id)
    await saveSession.unsavedDiscard(page).click()
    await expectOnBranch(page, main)
    await expectNoEmptyPaint(page)
    await expect(reader.editTextarea(page)).toHaveCount(0)
    expect(await entryContent(page, fork.id, entryId)).toBe(original as string)
  })

  test('rename writes the trimmed name with Enter, and Esc leaves a second rename', async () => {
    const page = app.window
    const { main, fork } = hero
    await branchNavigator.chip(page, main.name, 2).click()
    await branchNavigator.renameButton(page, fork.name).click()
    const input = branchNavigator.renameInput(page)
    await expect(input).toHaveValue(fork.name)
    await input.fill(`  ${RENAMED}  `)
    await input.press('Enter')
    await expect.poll(() => branchName(page, fork.id), { timeout: 10_000 }).toBe(RENAMED)
    await expect(input).toHaveCount(0)
    await expect(branchNavigator.row(page, RENAMED)).toBeVisible()
    // Enter inside the input pressed no row: the reader is still on Main.
    expect(await currentBranchId(page, HERO_STORY)).toBe(main.id)
    hero = { ...hero, fork: { ...fork, name: RENAMED } }

    await branchNavigator.renameButton(page, RENAMED).click()
    await input.fill(ESCAPED_NAME)
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(branchNavigator.title(page, 2)).toBeVisible()
    await expect(branchNavigator.row(page, RENAMED)).toBeVisible()
    // A save would land well inside this; a cancel writes nothing at all.
    await page.waitForTimeout(1_000)
    expect(await branchName(page, fork.id)).toBe(RENAMED)
    await page.keyboard.press('Escape')
    await expect(branchNavigator.navigator(page)).toHaveCount(0)
  })

  test('after a switch, the breadcrumb, Back and the story list all reach that branch', async () => {
    const page = app.window
    const { main, fork } = hero
    await switchTo(page, main, fork)
    await storySettings.openFromReader(page).click()
    await expect(storySettings.breadcrumb(page)).toBeVisible({ timeout: 20_000 })
    await storySettings.breadcrumbStory(page, hero.title).click()
    await expectOnBranch(page, fork)
    await expect(storySettings.breadcrumb(page)).toHaveCount(0)

    await chrome.back(page).click()
    await expect(home.openStory(page, hero.title)).toBeVisible({ timeout: 10_000 })
    await expect(reader.composer(page)).toHaveCount(0)

    await openStoryNamed(page, hero.title)
    await expectOnBranch(page, fork)
  })

  test('a single-branch story shows no chip, and Browse branches… lists its one branch', async () => {
    const page = app.window
    await chrome.back(page).click()
    await expect(home.newStory(page)).toBeVisible({ timeout: 10_000 })
    const stories = await queryApp(
      page,
      `SELECT s.title, b.name FROM stories s JOIN branches b ON b.story_id = s.id
        WHERE s.status = 'active'
          AND (SELECT count(*) FROM branches o WHERE o.story_id = s.id) = 1
          AND EXISTS (SELECT 1 FROM story_entries e WHERE e.branch_id = b.id)
        ORDER BY s.title LIMIT 1`,
    )
    expect(stories, 'an active single-branch story with entries').toHaveLength(1)
    const [[title, onlyName]] = stories
    await openStoryNamed(page, title as string)
    await chrome.actionsTrigger(page).click()
    await branchNavigator.browseBranchesRow(page).click()
    await expect(branchNavigator.title(page, 1)).toBeVisible()
    await expect(branchNavigator.renameButton(page, onlyName as string)).toBeVisible()
    await expect(branchNavigator.anyRenameButton(page)).toHaveCount(1)
    await expect(branchNavigator.anyDeleteButton(page)).toHaveCount(0)
    // The store holds the story's row by now (the navigator lists it), so a chip would be showing.
    await expect(branchNavigator.anyChip(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(branchNavigator.navigator(page)).toHaveCount(0)
  })
})

test.describe('branch navigator — paused under a run', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval runs ahead of narrative, so a held stream needs the embedder installed.
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

  test('a held run pauses the rows, rename stays live, and the release lets the switch through', async () => {
    test.setTimeout(150_000)
    const page = app.window
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })
    const { title, main, fork } = await readHero(page)
    await openStoryNamed(page, title)

    mock.holdNextNarrative()
    await reader.composer(page).fill(HELD_ACTION)
    await reader.send(page).click()
    await expect(reader.cancel(page)).toBeVisible({ timeout: 20_000 })
    // The recorded stream is the proof the turn holds the gate, not a retrieval still before it.
    await expect.poll(() => mock.requests.some((r) => r.streamed), { timeout: 20_000 }).toBe(true)

    await chrome.actionsTrigger(page).click()
    await branchNavigator.browseBranchesRow(page).click()
    await expect(branchNavigator.title(page, 2)).toBeVisible()
    await expect(branchNavigator.pausedBanner(page)).toBeVisible()
    // A paused row may be aria-disabled or pass the press to the list behind it: force the click.
    await branchNavigator.row(page, fork.name).click({ force: true })
    await page.waitForTimeout(1_000)
    await expect(branchNavigator.title(page, 2)).toBeVisible()
    expect(await currentBranchId(page, HERO_STORY)).toBe(main.id)

    await branchNavigator.renameButton(page, fork.name).click()
    await branchNavigator.renameInput(page).fill(PAUSED_NAME)
    await branchNavigator.renameInput(page).press('Enter')
    await expect.poll(() => branchName(page, fork.id), { timeout: 10_000 }).toBe(PAUSED_NAME)

    mock.releaseNarrative()
    // The turn's own phases and any pass behind it hold the gate; the rows come back with it.
    await expect(branchNavigator.pausedBanner(page)).toHaveCount(0, { timeout: 60_000 })
    await expect(branchNavigator.title(page, 2)).toBeVisible()
    await watchEmptyPaint(page)
    await branchNavigator.row(page, PAUSED_NAME).click()
    await expectOnBranch(page, { ...fork, name: PAUSED_NAME })
    await expectNoEmptyPaint(page)
  })
})
