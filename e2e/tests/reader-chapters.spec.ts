import { expect, test, type Page } from '@playwright/test'

import { goToWorld, openStory } from '../flows/navigation'
import { currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { plot } from '../locators/plot'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// A happening's create, anchored just outside the reader's trailing window.
const FIRE_DELTA = 'delta_hero_2'
// The flagged Brannoc's create, anchored at the tail: a reader that opens at the bottom already
// shows it, so a test has to scroll off it before a jump can prove anything.
const BRANNOC_DELTA = 'delta_hero_4'
const DRAFT = 'E2E dirty draft'

type DeltaAnchor = { entryId: string; position: number; targetId: string }

// Branch-scoped: entry ids repeat across branches.
async function deltaAnchor(page: Page, branchId: string, deltaId: string): Promise<DeltaAnchor> {
  const [[entryId, position, targetId]] = await queryApp(
    page,
    `SELECT e.id, e.position, d.target_id
     FROM deltas d
     JOIN story_entries e ON e.branch_id = d.branch_id AND e.id = d.entry_id
     WHERE d.branch_id = ? AND d.id = ?`,
    [branchId, deltaId],
  )
  return {
    entryId: entryId as string,
    position: position as number,
    targetId: targetId as string,
  }
}

// The oldest of the branch's newest 50 rows, which is what a fresh reader holds.
async function oldestInWindow(page: Page, branchId: string): Promise<number> {
  const [[oldest]] = await queryApp(
    page,
    `SELECT min(position) FROM (
       SELECT position FROM story_entries WHERE branch_id = ? ORDER BY position DESC LIMIT 50
     )`,
    [branchId],
  )
  return oldest as number
}

// A wheel, not a `scrollTop` write: only a gesture stops the bottom pin and an unsettled landing,
// either of which would undo a programmatic write.
async function scrollAwayFrom(page: Page, entryId: string, deltaY: number): Promise<void> {
  const row = reader.row(page, entryId)
  await expect(row).toBeInViewport()
  await reader.scroller(page).hover()
  await page.mouse.wheel(0, deltaY)
  await expect(row).not.toBeInViewport()
}

// The list's collapse outlives the screen, so a return visit finds Earlier already open.
async function openHappeningHistory(page: Page, title: string): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await chrome.goToPlotRow(page).click()
  await page.waitForURL(/\/plot\//)
  await plot.segmentCell(page, 'happening').click()
  const earlier = plot.tierHeader(page, t('plot:buckets.earlier'))
  if ((await earlier.getAttribute('aria-expanded')) === 'false') await earlier.click()
  await plot.row(page, title).click()
  await plot.tab(page, 'history').click()
}

// Serial suite, one shared app: test 1 leaves it on the reader, which test 2 starts from; test 2
// leaves it on the story list, which test 3 starts from.
test.describe.serial('Reader chapters', () => {
  let app: LaunchedApp
  let userDataDir: string
  let branchId: string
  let fire: DeltaAnchor
  let fireTitle: string

  test.beforeAll(async () => {
    userDataDir = createSeededUserDataDir().userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('a History row in Plot pops to the reader and lands on an entry outside the window', async () => {
    const page = app.window
    await openStory(page, HERO_TITLE)
    branchId = await currentBranchId(page, HERO_STORY)
    fire = await deltaAnchor(page, branchId, FIRE_DELTA)
    const [[title]] = await queryApp(
      page,
      `SELECT title FROM happenings WHERE branch_id = ? AND id = ?`,
      [branchId, fire.targetId],
    )
    fireTitle = title as string

    // A seed change that pulls the anchor into the window must fail here, not pass unproven.
    expect(fire.position).toBeLessThan(await oldestInWindow(page, branchId))
    await expect(reader.row(page, fire.entryId)).toHaveCount(0)

    await openHappeningHistory(page, fireTitle)
    await reader.historyEntryLink(page, 'create', fireTitle, fire.position).click()

    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.row(page, fire.entryId)).toBeInViewport()
    await expect(plot.subHeader(page)).toHaveCount(0)
  })

  test('a second press of the same row jumps again, and ← reaches the story list', async () => {
    const page = app.window
    await scrollAwayFrom(page, fire.entryId, 1_000_000)

    await openHappeningHistory(page, fireTitle)
    await reader.historyEntryLink(page, 'create', fireTitle, fire.position).click()

    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.row(page, fire.entryId)).toBeInViewport()

    await chrome.back(page).click()
    await expect(home.openStory(page, HERO_TITLE)).toBeVisible()
  })

  test('a dirty World pane raises its guard before a History row leaves', async () => {
    const page = app.window
    await openStory(page, HERO_TITLE)
    const brannoc = await deltaAnchor(page, branchId, BRANNOC_DELTA)
    await scrollAwayFrom(page, brannoc.entryId, -1_000_000)
    await goToWorld(page)
    const [[name, description]] = await queryApp(
      page,
      `SELECT name, description FROM entities WHERE branch_id = ? AND id = ?`,
      [branchId, brannoc.targetId],
    )

    await world.row(page, name as string).click()
    await world.tab(page, 'identity').click()
    await world.description(page).fill(DRAFT)
    await world.tab(page, 'history').click()
    const link = reader.historyEntryLink(page, 'create', name as string, brannoc.position)

    await link.click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await expect(page).toHaveURL(/\/world\//)

    await saveSession.unsavedCancel(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/world\//)
    await expect(world.subHeader(page)).toContainText(name as string)
    await world.tab(page, 'identity').click()
    await expect(world.description(page)).toHaveValue(DRAFT)

    await world.tab(page, 'history').click()
    await link.click()
    await saveSession.unsavedDiscard(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.row(page, brannoc.entryId)).toBeInViewport()
    expect(
      await queryApp(page, `SELECT description FROM entities WHERE branch_id = ? AND id = ?`, [
        branchId,
        brannoc.targetId,
      ]),
    ).toEqual([[description]])

    await chrome.back(page).click()
    await expect(home.openStory(page, HERO_TITLE)).toBeVisible()
  })
})

// Serial suite, one shared app: the jumps start from the fresh window the first two tests leave,
// and each later test starts from where the last one scrolled.
test.describe.serial('Reader chapter chrome', () => {
  const RICH_STORY = 'story_rich'
  const RICH_TITLE = 'The Gallery of Impossible Rooms'
  const FIRST_CHAPTER = 'Nine Days of Rain'
  const SECOND_CHAPTER = 'The Keep Leans Closer'
  // Two closed chapters on the hero branch, which the chip test pins from the DB.
  const OPEN_CHAPTER = 3
  // The label stops at minutes, so a retime has to cross one. Five hours does, and the DB check
  // below adds exactly that to the seeded seconds only from hour 0, which the form's value pins.
  const RETIMED_HOUR = '5'
  const RETIME_SECONDS = 5 * 3_600

  let app: LaunchedApp
  let userDataDir: string
  let branchId: string

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  // Chapters by title, never by position: a seed change moves chapter ends. A renamed chapter
  // throws: an undefined id would pass the `toHaveCount(0)` precondition below.
  async function chapterByTitle(page: Page, title: string) {
    const rows = await queryApp(
      page,
      `SELECT start_entry_id, end_entry_id, sequence_number FROM chapters WHERE branch_id = ? AND title = ?`,
      [branchId, title],
    )
    if (rows.length !== 1) throw new Error(`expected one chapter titled ${title}: ${rows.length}`)
    const [startEntryId, endEntryId, number] = rows[0]
    return {
      startEntryId: startEntryId as string,
      endEntryId: endEntryId as string,
      number: number as number,
    }
  }

  async function closedChapterCount(page: Page, branch: string): Promise<number> {
    const [[count]] = await queryApp(page, `SELECT count(*) FROM chapters WHERE branch_id = ?`, [
      branch,
    ])
    return count as number
  }

  async function worldTimeOf(page: Page, entryId: string): Promise<number> {
    const [[seconds]] = await queryApp(
      page,
      `SELECT json_extract(metadata, '$.worldTime') FROM story_entries WHERE branch_id = ? AND id = ?`,
      [branchId, entryId],
    )
    return seconds as number
  }

  test('the story card names the open chapter', async () => {
    await expect(home.openStory(app.window, HERO_TITLE)).toContainText(
      t('chapters:label', { number: OPEN_CHAPTER }),
    )
  })

  test('the top bar shows the open chapter and a time chip that formats as the footers do', async () => {
    const page = app.window
    await openStory(page, HERO_TITLE)
    branchId = await currentBranchId(page, HERO_STORY)
    expect(await closedChapterCount(page, branchId)).toBe(OPEN_CHAPTER - 1)

    await expect(reader.chapterChip(page, OPEN_CHAPTER)).toBeVisible()

    // The chip and an entry footer format world time down two paths. The seed spaces entries 3 s
    // apart and the label stops at minutes, so this can't tell the tail from a row near it.
    const [[tailId]] = await queryApp(
      page,
      `SELECT id FROM story_entries WHERE branch_id = ? AND kind != 'system' ORDER BY position DESC LIMIT 1`,
      [branchId],
    )
    const tailLabel = await reader.worldTimeFooter(page, tailId as string).innerText()
    await expect(reader.timeChip(page)).toContainText(tailLabel)
  })

  test('a closed row jumps from the fresh window to its first entry', async () => {
    const page = app.window
    const { startEntryId } = await chapterByTitle(page, FIRST_CHAPTER)
    // The window has painted, as the last test read its tail: this row really is outside it.
    await expect(reader.row(page, startEntryId)).toHaveCount(0)

    await reader.chapterChip(page, OPEN_CHAPTER).click()
    await reader.popoverRow(page, FIRST_CHAPTER).click()

    await expect(reader.popoverRow(page, FIRST_CHAPTER)).toBeHidden()
    await expect(reader.row(page, startEntryId)).toBeInViewport({ timeout: 20_000 })
  })

  test('a chapter jump opens under the break that heads it', async () => {
    const page = app.window
    const { startEntryId, number } = await chapterByTitle(page, SECOND_CHAPTER)

    await reader.chapterChip(page, OPEN_CHAPTER).click()
    await reader.popoverRow(page, SECOND_CHAPTER).click()

    // Whole, not a sliver: the row alone landing leaves part of its break in the 12 px gap above.
    await expect(reader.chapterBreak(page, number)).toBeInViewport({ ratio: 1 })
    await expect(reader.row(page, startEntryId)).toBeInViewport()
  })

  test('the strip opens the popover on desktop', async () => {
    const page = app.window
    await expect(reader.popoverRow(page, FIRST_CHAPTER)).toBeHidden()
    await reader.chapterProgressHit(page).click()
    await expect(reader.popoverRow(page, FIRST_CHAPTER)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(reader.popoverRow(page, FIRST_CHAPTER)).toBeHidden()
  })

  // The seam the unit test can't reach: a world-time edit moves neither part of the query's key,
  // so only the popover's refetch on open shows the new range.
  test('retiming a closed chapter’s last entry moves its range', async () => {
    const page = app.window
    const { endEntryId } = await chapterByTitle(page, SECOND_CHAPTER)
    const row = reader.popoverRow(page, SECOND_CHAPTER)
    const footer = reader.worldTimeFooter(page, endEntryId)

    await reader.row(page, endEntryId).scrollIntoViewIfNeeded()
    const seededSeconds = await worldTimeOf(page, endEntryId)
    // Seeded world time rises with position, so the end row's label is the range's last.
    const seededLabel = await footer.innerText()

    await reader.chapterChip(page, OPEN_CHAPTER).click()
    await expect(row).toContainText(seededLabel)
    await page.keyboard.press('Escape')
    await expect(row).toBeHidden()

    await footer.click()
    await expect(reader.worldTimeDialog(page)).toBeVisible()
    await expect(reader.worldTimeNumericField(page, 'Hour')).toHaveValue('0')
    await reader.worldTimeNumericField(page, 'Hour').fill(RETIMED_HOUR)
    await reader.worldTimeSave(page).click()
    await expect(reader.worldTimeDialog(page)).toBeHidden()
    await expect
      .poll(() => worldTimeOf(page, endEntryId), { timeout: 15_000 })
      .toBe(seededSeconds + RETIME_SECONDS)
    await expect(footer).not.toHaveText(seededLabel)
    const retimedLabel = await footer.innerText()

    await reader.chapterChip(page, OPEN_CHAPTER).click()
    await expect(row).toContainText(retimedLabel)
    await expect(row).not.toContainText(seededLabel)
    await page.keyboard.press('Escape')
    await expect(row).toBeHidden()
  })

  test('a story with no closed chapter reads Chapter 1', async () => {
    const page = app.window
    await chrome.back(page).click()
    await openStory(page, RICH_TITLE)
    expect(await closedChapterCount(page, await currentBranchId(page, RICH_STORY))).toBe(0)

    await expect(reader.chapterChip(page, 1)).toBeVisible()
  })
})
