import { expect, test, type Page } from '@playwright/test'

import type { RailCategory } from '@/lib/reader-rail'

import { currentBranchId, queryApp, tailMetadata } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { plot } from '../locators/plot'
import { rail } from '../locators/rail'
import { reader } from '../locators/reader'

// reader-composer.md → Browse rail at the seams only a running app reaches: rows from the real
// stores, a row press landing Plot, the preference written to app_settings and read back after a
// relaunch, the global shortcut over a focused composer, and real window resizes. The display
// reducer: lib/reader-rail/display.test.ts; hit zones and tints: rail-strip.stories.tsx; category
// switching and search copy: browse-rail.stories.tsx. See docs/testing.md → Coverage.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
const SEEDED_CHARACTER = 'Mira'
const SEEDED_THREAD = 'What the amulet wants'
// An active filler story in adventure mode; its branch has no threads.
const OTHER_TITLE = 'Sable and the Redrawn Coast'
// Matches the hero's one pending thread, so the typed search is a real narrowing.
const SEARCH_TEXT = 'Syndicate'

// Literal rather than RAIL_CATEGORIES, so the expectation isn't the constant the rail renders.
const SEVEN_CATEGORIES: readonly RailCategory[] = [
  'character',
  'location',
  'item',
  'faction',
  'lore',
  'thread',
  'happening',
]

// Under the ~900 px collapse threshold, over the 640 px phone tier: the rail column stays mounted.
const NARROW_WIDTH = 820

const RAIL_PREFERENCE_SQL = `SELECT json_extract(appearance, '$.readerRailCollapsed') FROM app_settings WHERE id = 'singleton'`

// json_extract reads a JSON boolean back as 0 / 1, and a missing key as null.
async function storedRailCollapsed(page: Page): Promise<unknown> {
  const [[value]] = await queryApp(page, RAIL_PREFERENCE_SQL)
  return value
}

// tailMetadata reads the last ai_reply. On the seeded hero branch only a system banner follows
// it, so it is the head turn's tail, whose scene the strip counts.
async function charactersInScene(page: Page, branchId: string): Promise<number> {
  const ids = (await tailMetadata(page, branchId))?.sceneEntities ?? []
  const [[count]] = await queryApp(
    page,
    `SELECT count(*) FROM entities WHERE branch_id = ? AND kind = 'character' AND id IN (SELECT value FROM json_each(?))`,
    [branchId, JSON.stringify(ids)],
  )
  return Number(count)
}

// Resizes the real BrowserWindow, as a user's drag would. Returns the width it replaced.
function setWindowWidth(app: LaunchedApp, width: number): Promise<number> {
  return app.app.evaluate(({ BrowserWindow }, next) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [previous, height] = win.getSize()
    win.setSize(next, height)
    return previous
  }, width)
}

const innerWidth = (page: Page): Promise<number> => page.evaluate(() => window.innerWidth)

// Serial suite on one seeded user-data dir: each test starts where the last left the rail, and the
// relaunch reopens the same dir, so no launch owns it and afterAll removes it once.
test.describe.serial('Browse rail', () => {
  let app: LaunchedApp
  let userDataDir: string
  let branchId: string

  test.beforeAll(async () => {
    userDataDir = createSeededUserDataDir().userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: false })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('lists the branch rows under all seven categories and lands Plot on a pressed thread', async () => {
    const page = app.window
    await home.openStory(page, HERO_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    branchId = await currentBranchId(page, HERO_STORY)

    // First launch: the seeded preference is false, so the rail opens expanded.
    expect(await storedRailCollapsed(page)).toBe(0)
    await expect(rail.column(page)).toBeVisible()
    await expect(rail.strip(page)).toHaveCount(0)
    await expect(rail.row(page, SEEDED_CHARACTER)).toBeVisible()

    await rail.categoryTrigger(page).click()
    for (const category of SEVEN_CATEGORIES) {
      await expect(rail.categoryOption(page, category)).toBeVisible()
    }
    await rail.categoryOption(page, 'thread').click()
    await expect(rail.search(page, 'thread')).toBeVisible()

    const [[threadId]] = await queryApp(
      page,
      `SELECT id FROM threads WHERE branch_id = ? AND title = ?`,
      [branchId, SEEDED_THREAD],
    )
    await rail.row(page, SEEDED_THREAD).click()
    await page.waitForURL(new RegExp(`/plot/${branchId}\\?kind=thread&id=${threadId as string}`))
    await expect(plot.subHeader(page)).toContainText(t('plot:kinds.thread'))
    await expect(plot.subHeader(page)).toContainText(SEEDED_THREAD)

    await chrome.back(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(rail.column(page)).toBeVisible()
  })

  test('the chevron collapses to the strip, which counts the scene, and stores the preference', async () => {
    const page = app.window
    const characters = await charactersInScene(page, branchId)
    // Zero would also match a strip that never read the scene.
    expect(characters).toBeGreaterThan(0)

    await rail.collapse(page).click()
    await expect(rail.strip(page)).toBeVisible()
    await expect(rail.column(page)).toHaveCount(0)
    await expect(rail.stripCell(page, 'character', characters)).toBeVisible()
    await expect.poll(() => storedRailCollapsed(page)).toBe(1)
  })

  test('a strip cell expands the rail onto its category', async () => {
    const page = app.window
    // The rail was left on Threads, so Items showing proves the cell switched it.
    await rail.stripCell(page, 'item').click()
    await expect(rail.column(page)).toBeVisible()
    await expect(rail.strip(page)).toHaveCount(0)
    await expect(rail.search(page, 'item')).toBeVisible()
    await expect.poll(() => storedRailCollapsed(page)).toBe(0)
  })

  test('Ctrl+\\ toggles the rail while the composer has focus', async () => {
    const page = app.window
    await reader.composer(page).click()
    await expect(reader.composer(page)).toBeFocused()

    await page.keyboard.press('Control+Backslash')
    await expect(rail.strip(page)).toBeVisible()
    await expect.poll(() => storedRailCollapsed(page)).toBe(1)

    await expect(reader.composer(page)).toBeFocused()
    await page.keyboard.press('Control+Backslash')
    await expect(rail.column(page)).toBeVisible()
    await expect.poll(() => storedRailCollapsed(page)).toBe(0)
  })

  test('the collapsed preference survives a relaunch', async () => {
    // A close, a cold launch and a story open, on top of this test's own steps.
    test.setTimeout(150_000)
    await rail.collapse(app.window).click()
    await expect.poll(() => storedRailCollapsed(app.window)).toBe(1)

    await app.close()
    app = await launchApp({ userDataDir, cleanupUserData: false })
    const page = app.window
    await home.openStory(page, HERO_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await expect(rail.strip(page)).toBeVisible()
    await expect(rail.column(page)).toHaveCount(0)
  })

  test('a narrow window collapses the display without touching the preference', async () => {
    const page = app.window
    await rail.expand(page).click()
    await expect(rail.column(page)).toBeVisible()
    await expect.poll(() => storedRailCollapsed(page)).toBe(0)

    const fullWidth = await setWindowWidth(app, NARROW_WIDTH)
    await expect.poll(() => innerWidth(page)).toBeLessThan(900)
    await expect(rail.strip(page)).toBeVisible()
    await expect(rail.column(page)).toHaveCount(0)
    expect(await storedRailCollapsed(page)).toBe(0)

    // The decisive half: a forced collapse that wrote the preference would keep the strip here.
    await setWindowWidth(app, fullWidth)
    await expect.poll(() => innerWidth(page)).toBeGreaterThan(980)
    await expect(rail.column(page)).toBeVisible()
    await expect(rail.strip(page)).toHaveCount(0)
    expect(await storedRailCollapsed(page)).toBe(0)
  })

  test('entering another story keeps the category and resets the filter and search', async () => {
    const page = app.window
    await rail.categoryTrigger(page).click()
    await rail.categoryOption(page, 'thread').click()
    await rail.threadChip(page, 'pending').click()
    await rail.search(page, 'thread').fill(SEARCH_TEXT)
    await expect(rail.threadChip(page, 'pending')).toHaveAttribute('aria-pressed', 'true')
    await expect(rail.search(page, 'thread')).toHaveValue(SEARCH_TEXT)

    // Only the hero seeds threads, so the other story's list is empty; its toolbar stays mounted,
    // which is where the kept category, the reset filter and the cleared search show.
    await chrome.back(page).click()
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })
    await home.openStory(page, OTHER_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })

    await expect(rail.search(page, 'thread')).toBeVisible()
    await expect(rail.search(page, 'thread')).toHaveValue('')
    await expect(rail.threadChip(page, 'all')).toHaveAttribute('aria-pressed', 'true')
    await expect(rail.threadChip(page, 'pending')).toHaveAttribute('aria-pressed', 'false')
  })
})
