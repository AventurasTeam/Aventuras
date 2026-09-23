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

// Serial suite, one shared app: tests build on earlier ones' state. GO TO (useSurfaceNavigate)
// matches stack entries by path: it pops to a screen already in the stack, which DISMISSES the
// instances above it, and pushes one that isn't. Each test selects the row it edits.
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
    // Two closed chapters (entries 1-58) plus open region from 59 — all three buckets exercised.
    // hap_pact anchors entry 59 (seed-dataset.ts), a real open-region row — Current isn't empty.
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

    // InlineEditableName: press the placeholder, type into the still-placeholder-named
    // Input, Enter commits.
    await plot.nameTrigger(page).click()
    await plot.nameInput(page).fill('E2E thread')
    await page.keyboard.press('Enter')
    await saveSession.saveBarSave(page).click()

    await expect(plot.subHeader(page)).toContainText('E2E thread')
    const rows = await queryApp(
      page,
      `SELECT status FROM threads WHERE branch_id = ? AND title = ?`,
      [branchId, 'E2E thread'],
    )
    expect(rows).toEqual([['pending']])
    // Active stays expanded too, so only collapsing Pending proves the row sits under it.
    await expect(plot.row(page, 'E2E thread')).toBeVisible()
    await plot.tierHeader(page, t('plot:tiers.pending')).click()
    await expect(plot.row(page, 'E2E thread')).toHaveCount(0)
    await plot.tierHeader(page, t('plot:tiers.pending')).click()
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
        { timeout: 30_000 },
      )
      .toBeNull()
  })

  // Row + link edits share one action_id. Awareness diffs by characterId, so retargeting
  // Mira -> Vorne is a delete plus a create; Kael's untouched row is the control.
  test('one Save carries an Overview edit and awareness link changes under one action_id; undo reverses all of it', async () => {
    const page = app.window
    await reader.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)
    await plot.segmentCell(page, 'happening').click()
    await plot.tierHeader(page, t('plot:buckets.earlier')).click()
    await plot.row(page, 'The alley ambush').click()

    const [[hapId]] = await queryApp(
      page,
      `SELECT id FROM happenings WHERE branch_id = ? AND title = ?`,
      [branchId, 'The alley ambush'],
    )
    const [[originalDescription]] = await queryApp(
      page,
      `SELECT description FROM happenings WHERE id = ?`,
      [hapId],
    )
    const entityId = async (name: string) => {
      const [[id]] = await queryApp(
        page,
        `SELECT id FROM entities WHERE branch_id = ? AND name = ?`,
        [branchId, name],
      )
      return id as string
    }
    const awarenessId = async (characterId: string) => {
      const [[id]] = await queryApp(
        page,
        `SELECT id FROM happening_awareness WHERE happening_id = ? AND character_id = ?`,
        [hapId, characterId],
      )
      return id as string
    }
    const kaelId = await entityId('Kael')
    const miraId = await entityId('Mira')
    const sageId = await entityId('The Ashen Sage')
    const vorneId = await entityId('Vorne')
    const kaelAwarenessId = await awarenessId(kaelId)
    const miraAwarenessId = await awarenessId(miraId)

    await plot.tab(page, 'overview').click()
    await plot.description(page).fill('Written by E2E')
    await plot.tab(page, 'awareness').click()

    // A genuinely new row (Sage) — exercises the field-array append path.
    await plot.addAwareness(page).click()
    await plot.characterPicker(page).click()
    await plot.pickerOption(page, 'The Ashen Sage').click()

    await plot.characterPickerSet(page, 'Mira').click()
    await plot.pickerOption(page, 'Vorne').click()

    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)

    const happeningDeltaRows = await queryApp(
      page,
      `SELECT action_id, op FROM deltas WHERE branch_id = ? AND target_table = 'happenings' AND target_id = ? ORDER BY log_position`,
      [branchId, hapId],
    )
    expect(happeningDeltaRows.map((r) => r[1])).toEqual(['update'])
    const actionId = happeningDeltaRows[0][0] as string

    const groupCounts = await queryApp(
      page,
      `SELECT target_table, op, COUNT(*) FROM deltas WHERE action_id = ? GROUP BY target_table, op ORDER BY target_table, op`,
      [actionId],
    )
    expect(groupCounts).toEqual([
      ['happening_awareness', 'create', 2],
      ['happening_awareness', 'delete', 1],
      ['happenings', 'update', 1],
    ])
    expect(
      await queryApp(page, `SELECT COUNT(*) FROM deltas WHERE action_id = ?`, [actionId]),
    ).toEqual([[4]])
    // Kael's row never changed: it must not appear under this action_id at all.
    expect(
      await queryApp(page, `SELECT COUNT(*) FROM deltas WHERE action_id = ? AND target_id = ?`, [
        actionId,
        kaelAwarenessId,
      ]),
    ).toEqual([[0]])
    // The delete targets Mira's ORIGINAL committed row, not a freshly generated one.
    expect(
      await queryApp(
        page,
        `SELECT COUNT(*) FROM deltas WHERE action_id = ? AND target_table = 'happening_awareness' AND op = 'delete' AND target_id = ?`,
        [actionId, miraAwarenessId],
      ),
    ).toEqual([[1]])

    // World isn't in the stack yet, so Open in World pushes it with its params and GO TO back
    // resumes this Plot instance.
    await plot.openInWorldAwareness(page, 'Kael').click()
    await page.waitForURL(new RegExp(`/world/${branchId}\\?kind=character&id=${kaelId}`))
    await expect(world.detailName(page)).toHaveText('Kael')

    await world.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)
    await expect(plot.tab(page, 'awareness')).toHaveAttribute('aria-selected', 'true')

    await plot.actionsTrigger(page).click()
    await plot.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await reader.actionsTrigger(page).click()
    await reader.undoRow(page).click()

    const revertedState = async () => {
      const [[description]] = await queryApp(
        page,
        `SELECT description FROM happenings WHERE id = ?`,
        [hapId],
      )
      const mira = await queryApp(
        page,
        `SELECT id FROM happening_awareness WHERE happening_id = ? AND character_id = ?`,
        [hapId, miraId],
      )
      const [[goneCount]] = await queryApp(
        page,
        `SELECT COUNT(*) FROM happening_awareness WHERE happening_id = ? AND character_id IN (?, ?)`,
        [hapId, sageId, vorneId],
      )
      return [description, mira[0]?.[0] ?? null, goneCount]
    }
    await expect
      .poll(revertedState, { timeout: 30_000 })
      .toEqual([originalDescription, miraAwarenessId, 0])
  })

  test('a dirty pane guards a row switch, the chrome back and a GO TO push; Cancel keeps the draft', async () => {
    const page = app.window
    await reader.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)
    const description = async (title: string) =>
      (
        await queryApp(page, `SELECT description FROM threads WHERE branch_id = ? AND title = ?`, [
          branchId,
          title,
        ])
      )[0][0]
    const committed = await description('What the amulet wants')

    await plot.segmentCell(page, 'thread').click()
    await plot.row(page, 'What the amulet wants').click()
    await plot.description(page).fill('E2E dirty draft')
    // The collapse store is session-scoped: an earlier test may have left Pending open.
    const pending = plot.tierHeader(page, t('plot:tiers.pending'))
    if ((await pending.getAttribute('aria-expanded')) !== 'true') await pending.click()

    const cancelKeepsDraft = async () => {
      await expect(saveSession.unsavedDialog(page)).toBeVisible()
      await saveSession.unsavedCancel(page).click()
      await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
      await expect(page).toHaveURL(/\/plot\//)
      await expect(plot.subHeader(page)).toContainText('What the amulet wants')
      await expect(plot.description(page)).toHaveValue('E2E dirty draft')
    }
    await plot.row(page, 'Expose the Syndicate broker').click()
    await cancelKeepsDraft()
    // A pop: only the route's usePreventRemove sees it.
    await plot.back(page).click()
    await cancelKeepsDraft()
    // World left the stack in an earlier test, so this pushes: only beforeNavigate sees it.
    await plot.actionsTrigger(page).click()
    await world.goToWorldRow(page).click()
    await cancelKeepsDraft()
    expect(await description('What the amulet wants')).toBe(committed)
  })

  // The chrome back pops through usePreventRemove: Discard must replay that pop, in one click.
  test("a dirty pane's back to the reader discards in one click", async () => {
    const page = app.window
    await expect(plot.description(page)).toHaveValue('E2E dirty draft')

    await plot.back(page).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    const navigated = expect(
      page,
      'a second prompt or a stuck guard keeps us off the reader',
    ).toHaveURL(/\/reader-composer\//, { timeout: 15_000 })
    await saveSession.unsavedDiscard(page).click()
    await navigated

    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const [[description]] = await queryApp(
      page,
      `SELECT description FROM threads WHERE branch_id = ? AND title = ?`,
      [branchId, 'What the amulet wants'],
    )
    expect(description).not.toBe('E2E dirty draft')
  })

  test('a cold-mount deep link preselects the row, and its tab opens that mount only', async () => {
    const page = app.window
    // The prior test ended on the reader, which dismissed Plot: this is a fresh instance.
    await reader.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)

    // IDs are UUID-substituted too (lib/ids/prefixes.ts) — read fresh here, not hard-coded.
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

    // Reopening the row mounts a new pane, which the spent link no longer steers.
    await plot.tab(page, 'overview').click()
    await plot.subHeaderKind(page, 'happening').click()
    await expect(plot.subHeader(page)).not.toContainText('The alley ambush')
    await plot.row(page, 'The alley ambush').click()
    await expect(plot.tab(page, 'overview')).toHaveAttribute('aria-selected', 'true')

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

    await plot.segmentCell(page, 'thread').click()
    await plot.row(page, 'What the amulet wants').click()
    await plot.description(page).fill('dirty')
    await plot.segmentCell(page, 'happening').click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedDiscard(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(plot.row(page, 'Vorne’s pact')).toBeVisible()
  })
})
