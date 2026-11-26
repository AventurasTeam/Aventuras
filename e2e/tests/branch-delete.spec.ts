import { expect, test, type Page } from '@playwright/test'

import { VEC_FAMILIES } from '@/lib/db'

import { currentBranchId, queryApp, queryScalar, seedVectors, vecCounts } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  insertFinishedRun,
  markSwapPending,
  otherBranchId,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { branchDelete } from '../locators/branch-delete'
import { branchNavigator } from '../locators/branch-navigator'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// branch-navigator.md → Delete confirm, driven through the reader and read back from the DB; the
// confirm's states are Storybook's (docs/testing.md → Coverage). Each launch reads the hero's
// branches from the DB and takes no turn on the fork (C7).
const HERO_STORY = 'story_hero'
const HELD_ACTION = 'E2E-BRANCH-DELETE-HELD I wait out the storm at the gate.'
const SWAP_TARGET = 'onnx-community/embeddinggemma-300m-ONNX'

// A family table and the shadow tables vec0 keeps beside it (`_chunks`, `_rowids`, …): vec0's
// branch_id is a partition key, so vecCounts reads the families instead.
const VEC_TABLE = new RegExp(`^(?:${Object.values(VEC_FAMILIES).join('|')})_[1-9][0-9]*(?:_|$)`)

type BranchFacts = { id: string; name: string }
type Hero = { title: string; main: BranchFacts; fork: BranchFacts }

// The branch the story points at on launch is the current one; the story's other branch is the fork.
async function readHero(page: Page): Promise<Hero> {
  const [[title]] = await queryApp(page, `SELECT title FROM stories WHERE id = ?`, [HERO_STORY])
  const currentId = await currentBranchId(page, HERO_STORY)
  const rows = await queryApp(
    page,
    `SELECT id, name FROM branches WHERE story_id = ? ORDER BY created_at, id`,
    [HERO_STORY],
  )
  expect(rows, 'the hero story holds two branches').toHaveLength(2)
  const branches = rows.map(([id, name]) => ({ id: id as string, name: name as string }))
  const main = branches.find((b) => b.id === currentId)
  const fork = branches.find((b) => b.id !== currentId)
  if (main === undefined || fork === undefined) throw new Error(`no fork beside ${currentId}`)
  return { title: title as string, main, fork }
}

async function openStoryNamed(page: Page, title: string): Promise<void> {
  await home.openStory(page, title).click()
  await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
}

async function branchCount(page: Page): Promise<number> {
  return queryScalar(page, `SELECT count(*) FROM branches WHERE story_id = ?`, [HERO_STORY])
}

// Every table with a branch_id column, the vec families and their shadow tables aside.
async function branchColumnTables(page: Page): Promise<string[]> {
  const rows = await queryApp(
    page,
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
  )
  const tables: string[] = []
  for (const [name] of rows) {
    const table = name as string
    if (VEC_TABLE.test(table)) continue
    const columns = await queryScalar(
      page,
      `SELECT count(*) FROM pragma_table_info(?) WHERE name = 'branch_id'`,
      [table],
    )
    if (columns > 0) tables.push(table)
  }
  return tables
}

async function rowCounts(
  page: Page,
  tables: readonly string[],
  branchId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of tables) {
    counts[table] = await queryScalar(page, `SELECT count(*) FROM "${table}" WHERE branch_id = ?`, [
      branchId,
    ])
  }
  return counts
}

// The confirm's count by its definition (branch-navigator.md → Delete confirm), from the two id
// lists rather than the action's query.
async function onlyOn(page: Page, branchId: string, otherId: string): Promise<number> {
  const own = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND kind <> 'system'`,
    [branchId],
  )
  const other = await queryApp(page, `SELECT id FROM story_entries WHERE branch_id = ?`, [otherId])
  const held = new Set(other.map(([id]) => id as string))
  return own.filter(([id]) => !held.has(id as string)).length
}

// The current row's pressable holds its marker icon and its name, so its text is the name.
async function focusedText(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.textContent ?? null)
}

// Serial: the delete runs in the reader the first test leaves open. A retry reruns the group from
// its first test, in a fresh launch.
test.describe.serial('branch delete — the confirm, the cascade and the chip', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let runId: string
  let hero: Hero

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    // No embedder: nothing drains, so vectors move only through the delete (seedVectors' terms).
    // Read from the seeded file: the run row goes in before launch, while the harness may write it.
    runId = insertFinishedRun(seeded.dbPath, otherBranchId(seeded.dbPath, HERO_STORY))
    app = await launchApp({ userDataDir, cleanupUserData: true })
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 20_000 })
    hero = await readHero(app.window)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('only the other row offers delete, and Cancel leaves the navigator as it was', async () => {
    const page = app.window
    const { main, fork } = hero
    await openStoryNamed(page, hero.title)
    const count = await branchCount(page)
    expect(count, "the story's branches, from the DB").toBe(2)
    const chip = branchNavigator.chip(page, main.name, count)
    await expect(chip).toBeVisible({ timeout: 20_000 })
    await chip.click()
    await expect(branchNavigator.title(page, count)).toBeVisible()
    await expect(branchNavigator.deleteButton(page, fork.name)).toBeVisible()
    await expect(branchNavigator.deleteButton(page, main.name)).toHaveCount(0)
    await expect(branchNavigator.anyDeleteButton(page)).toHaveCount(1)

    await branchNavigator.deleteButton(page, fork.name).click()
    await expect(branchDelete.dialog(page, fork.name)).toBeVisible()
    await branchDelete.cancel(page).click()
    await expect(branchDelete.dialog(page, fork.name)).toHaveCount(0)
    await expect(branchNavigator.title(page, count)).toBeVisible()
    await expect(branchNavigator.deleteButton(page, fork.name)).toBeFocused()
    expect(await queryScalar(page, `SELECT count(*) FROM branches WHERE id = ?`, [fork.id])).toBe(1)

    await page.keyboard.press('Escape')
    await expect(branchNavigator.navigator(page)).toHaveCount(0)
  })

  test('Delete branch takes every row of the fork, and the chip waits for the navigator', async () => {
    const page = app.window
    const { main, fork } = hero
    const [[shared]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ?
          AND id IN (SELECT id FROM entities WHERE branch_id = ?) ORDER BY id LIMIT 1`,
      [fork.id, main.id],
    )
    const sharedId = shared as string
    // One id on both branches: the fork's vectors go, the same id's on the current branch stay.
    await seedVectors(page, 'entity', fork.id, sharedId)
    await seedVectors(page, 'entity', main.id, sharedId)
    expect(await vecCounts(page, 'entity', fork.id, sharedId)).toEqual({ 384: 1, 8: 1 })
    const mainVectors = await vecCounts(page, 'entity', main.id, sharedId)
    expect(mainVectors).toEqual({ 384: 1, 8: 1 })

    const tables = await branchColumnTables(page)
    expect(tables).toContain('pipeline_runs')
    expect(tables).toContain('story_entries')
    const mainBefore = await rowCounts(page, tables, main.id)
    const forkBefore = await rowCounts(page, tables, fork.id)
    expect(forkBefore.story_entries, "the fork's entries").toBeGreaterThan(0)
    expect(
      await queryScalar(
        page,
        `SELECT count(*) FROM pipeline_runs WHERE run_id = ? AND branch_id = ?`,
        [runId, fork.id],
      ),
      'the finished run seeded on the fork',
    ).toBe(1)
    const expected = await onlyOn(page, fork.id, main.id)
    expect(expected, 'entries only the fork holds').toBeGreaterThan(0)
    const count = await branchCount(page)

    await branchNavigator.chip(page, main.name, count).click()
    await expect(branchNavigator.title(page, count)).toBeVisible()
    await branchNavigator.deleteButton(page, fork.name).click()
    await expect(branchDelete.dialog(page, fork.name)).toBeVisible()
    await expect(branchDelete.countLine(page, expected)).toBeVisible()
    await branchDelete.confirm(page).click()

    await expect
      .poll(() => queryScalar(page, `SELECT count(*) FROM branches WHERE id = ?`, [fork.id]), {
        timeout: 15_000,
      })
      .toBe(0)
    await expect(branchDelete.dialog(page, fork.name)).toHaveCount(0)
    // The header's count drops at once, the chip's when the navigator closes (Delete confirm).
    await expect(branchNavigator.chip(page, main.name, count)).toBeVisible()
    await expect(branchNavigator.title(page, count - 1)).toBeVisible()
    await expect(branchNavigator.row(page, main.name)).toBeVisible()
    await expect(branchNavigator.row(page, fork.name)).toHaveCount(0)
    await expect(branchNavigator.anyDeleteButton(page)).toHaveCount(0)
    await expect.poll(() => focusedText(page)).toBe(main.name)

    await page.keyboard.press('Escape')
    await expect(branchNavigator.navigator(page)).toHaveCount(0)
    await expect(branchNavigator.anyChip(page)).toHaveCount(0)

    expect(await rowCounts(page, tables, fork.id)).toEqual(
      Object.fromEntries(tables.map((table) => [table, 0])),
    )
    expect(await rowCounts(page, tables, main.id)).toEqual(mainBefore)
    expect(await vecCounts(page, 'entity', fork.id, sharedId)).toEqual({ 384: 0, 8: 0 })
    expect(await vecCounts(page, 'entity', main.id, sharedId)).toEqual(mainVectors)
    expect(
      await queryScalar(page, `SELECT count(*) FROM pipeline_runs WHERE run_id = ?`, [runId]),
    ).toBe(0)
    expect(await currentBranchId(page, HERO_STORY)).toBe(main.id)
  })
})

test.describe('branch delete — hidden while a run holds the gate', () => {
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

  test('no row offers delete while the turn holds the gate; the other row does after', async () => {
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
    await expect(branchNavigator.renameButton(page, fork.name)).toBeVisible()
    await expect(branchNavigator.anyDeleteButton(page)).toHaveCount(0)

    mock.releaseNarrative()
    // The turn's own phases and any pass behind it hold the gate; the delete control returns with it.
    await expect(branchNavigator.deleteButton(page, fork.name)).toBeVisible({ timeout: 60_000 })
    await expect(branchNavigator.anyDeleteButton(page)).toHaveCount(1)
    await expect(branchNavigator.pausedBanner(page)).toHaveCount(0)
    expect(await currentBranchId(page, HERO_STORY)).toBe(main.id)
  })
})

test.describe('branch delete — hidden under a pending swap', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    markSwapPending(seeded.dbPath, HERO_STORY, SWAP_TARGET)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('no row offers delete, and the rows are not paused', async () => {
    const page = app.window
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })
    const { title, main, fork } = await readHero(page)
    await openStoryNamed(page, title)
    // The open asks whether to resume the swap; deferring it leaves the marker in place.
    await expect(storySettings.resumePrompt(page)).toBeVisible({ timeout: 20_000 })
    await storySettings.resumeLater(page).click()
    await expect(storySettings.resumePrompt(page)).toHaveCount(0)

    await branchNavigator.chip(page, main.name, 2).click()
    await expect(branchNavigator.title(page, 2)).toBeVisible()
    await expect(branchNavigator.renameButton(page, fork.name)).toBeVisible()
    await expect(branchNavigator.anyDeleteButton(page)).toHaveCount(0)
    await expect(branchNavigator.pausedBanner(page)).toHaveCount(0)
  })
})
