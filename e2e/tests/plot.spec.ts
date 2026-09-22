import { expect, test } from '@playwright/test'

import { currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { reloadFromMain, suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { plot } from '../locators/plot'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

// Serial suite, one shared app: later tests build on earlier ones' selection and collapse state.
test.describe.serial('Plot panel', () => {
  let app: LaunchedApp
  let userDataDir: string
  let branchId: string

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('opens from the reader, lists threads by tier and happenings by bucket', async () => {
    const page = app.window
    await home.openStory(page, HERO_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await reader.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)
    branchId = await currentBranchId(page, HERO_STORY)

    // Active starts open, the other tiers closed: only the seeded active thread is mounted.
    await expect(plot.row(page, 'What the amulet wants')).toBeVisible()
    await expect(plot.row(page, 'Expose the Syndicate broker')).toHaveCount(0)
    await plot.tierHeader(page, t('plot:tiers.pending')).click()
    await expect(plot.row(page, 'Expose the Syndicate broker')).toBeVisible()

    await plot.segmentCell(page, 'happening').click()
    // Two closed chapters (entries 1-58) plus the open region from 59: all three buckets.
    // hap_pact anchors in the open region (lib/db/devtools/seed-dataset.ts), so Current isn't empty.
    await expect(plot.tierHeader(page, t('plot:buckets.current'))).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(plot.row(page, 'Vorne’s pact')).toBeVisible()
    await expect(plot.tierHeader(page, t('plot:buckets.earlier'))).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(plot.tierHeader(page, t('plot:buckets.out-of-narrative'))).toBeVisible()
    await expect(plot.chip(page, 'this-chapter')).toBeVisible()
    await plot.chip(page, 'out-of-narrative').click()
    await expect(plot.row(page, 'The old betrayal')).toBeVisible()
    await expect(plot.row(page, 'Vorne’s pact')).toHaveCount(0)
    await plot.chip(page, 'all').click()
  })

  test('creates a thread from [+] Blank and lists it under Pending', async () => {
    const page = app.window
    await plot.segmentCell(page, 'thread').click()
    await plot.addTrigger(page, 'thread').click()
    await plot.addMenuBlank(page).click()
    await expect(plot.subHeader(page)).toContainText(t('plot:detail.newThread'))

    // InlineEditableName: press the placeholder, type into the focused input, Enter commits.
    await page.getByRole('button', { name: t('plot:detail.namePlaceholder'), exact: true }).click()
    await page.locator('input:focus').fill('E2E thread')
    await page.keyboard.press('Enter')
    await saveSession.saveBarSave(page).click()

    await expect(plot.subHeader(page)).toContainText('E2E thread')
    const rows = await queryApp(
      page,
      `SELECT status FROM threads WHERE branch_id = ? AND title = ?`,
      [branchId, 'E2E thread'],
    )
    expect(rows).toEqual([['pending']])
    // Pending was expanded in the first test, so the new row is mounted under it.
    await expect(plot.row(page, 'E2E thread')).toBeVisible()
  })

  test('saves an Overview edit as one action_id and undo reverses it', async () => {
    const page = app.window
    await plot.description(page).fill('Written by E2E')
    await expect(saveSession.saveBarSave(page)).toBeVisible()
    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)

    const [[id]] = await queryApp(
      page,
      `SELECT id FROM threads WHERE branch_id = ? AND title = ?`,
      [branchId, 'E2E thread'],
    )
    const rows = await queryApp(
      page,
      `SELECT action_id, op FROM deltas WHERE branch_id = ? AND target_table = 'threads' AND target_id = ? ORDER BY log_position`,
      [branchId, id],
    )
    expect(rows.map((r) => r[1])).toEqual(['create', 'update'])
    const updateActionId = rows[1][0] as string
    expect(
      await queryApp(page, `SELECT COUNT(*) FROM deltas WHERE action_id = ?`, [updateActionId]),
    ).toEqual([[1]])

    // CTRL-Z lives on the reader; the Actions menu row is its touch-tier twin.
    await plot.actionsTrigger(page).click()
    await plot.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await reader.actionsTrigger(page).click()
    await reader.undoRow(page).click()
    await expect
      .poll(
        async () =>
          (await queryApp(page, `SELECT description FROM threads WHERE id = ?`, [id]))[0][0],
      )
      .toBeNull()
  })

  test('adds an awareness row, opens its character in World, then removes the row', async () => {
    const page = app.window
    await reader.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)
    await plot.segmentCell(page, 'happening').click()
    await plot.tierHeader(page, t('plot:buckets.earlier')).click()
    await plot.row(page, 'The alley ambush').click()
    await plot.tab(page, 'awareness').click()

    await plot.addAwareness(page).click()
    await plot.characterPicker(page).last().click()
    await plot.pickerOption(page, 'The Ashen Sage').click()
    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)

    const [[hapId]] = await queryApp(
      page,
      `SELECT id FROM happenings WHERE branch_id = ? AND title = ?`,
      [branchId, 'The alley ambush'],
    )
    const [[sageId]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ? AND name = ?`,
      [branchId, 'The Ashen Sage'],
    )
    const count = () =>
      queryApp(
        page,
        `SELECT COUNT(*) FROM happening_awareness WHERE happening_id = ? AND character_id = ?`,
        [hapId, sageId],
      ).then((r) => r[0][0])
    await expect.poll(count).toBe(1)

    // Open in World (cross-route seam): the happening pane's row-scoped icon action, not a route
    // World is already below in the stack — this spec has never visited World before, so the
    // known kind/id-dropping pop (05b-peek-drawer.md:145) can't fire here.
    const [[miraId]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ? AND name = ?`,
      [branchId, 'Mira'],
    )
    await plot.openInWorldAwareness(page, 'Mira').click()
    await page.waitForURL(new RegExp(`/world/${branchId}\\?kind=character&id=${miraId}`))
    await expect(world.detailName(page)).toHaveText('Mira')

    await world.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)
    await expect(plot.tab(page, 'awareness')).toHaveAttribute('aria-selected', 'true')

    await plot.removeAwareness(page, 'The Ashen Sage').click()
    await saveSession.saveBarSave(page).click()
    await expect.poll(count).toBe(0)
  })

  test('a cold-mount deep link preselects the row', async () => {
    const page = app.window
    await expect(plot.subHeader(page)).toBeVisible()

    // Entity/happening ids are UUID-substituted too (lib/ids/prefixes.ts) — read fresh, not
    // hard-coded.
    const [[ambushId]] = await queryApp(
      page,
      `SELECT id FROM happenings WHERE branch_id = ? AND title = ?`,
      [branchId, 'The alley ambush'],
    )

    await page.evaluate(
      ({ branchId, ambushId }) => {
        window.history.replaceState(
          null,
          '',
          `/plot/${branchId}?kind=happening&id=${ambushId}&tab=awareness`,
        )
      },
      { branchId, ambushId: ambushId as string },
    )

    const reloaded = page.waitForEvent('load')
    await reloadFromMain(app)
    await reloaded

    await expect(plot.subHeader(page)).toContainText(t('plot:kinds.happening'))
    await expect(plot.subHeader(page)).toContainText('The alley ambush')
    await expect(plot.tab(page, 'awareness')).toHaveAttribute('aria-selected', 'true')
    // The row sits in the collapsed Earlier bucket: visible proves the reveal expanded it.
    await expect(plot.row(page, 'The alley ambush')).toBeVisible()

    // Known screen for anything appended after this test.
    await plot.actionsTrigger(page).click()
    await plot.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
  })

  test('a dirty pane guards the segment switch', async () => {
    const page = app.window
    await reader.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)

    await plot.tab(page, 'overview').click()
    await plot.description(page).fill('dirty')
    await plot.segmentCell(page, 'thread').click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedDiscard(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(plot.row(page, 'What the amulet wants')).toBeVisible()
  })
})
