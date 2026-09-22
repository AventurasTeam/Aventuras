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
// matches stack entries by path; popping past an instance DISMISSES it (unmounts for good). Test
// 5's cold-mount reload leaves Plot as the stack's sole entry, so its reader trip PUSHES a new
// reader rather than dismissing Plot — test 6's GO TO back then resumes that same instance.
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
        { timeout: 30_000 },
      )
      .toBeNull()
  })

  // Test-intent: exercises save-happening.ts's invariant that row + link edits share one
  // action_id (undo reverses all). Mira -> Vorne retargets an EXISTING row — natural-key
  // diffing (keyed on characterId, no id fallback) reads this as delete-Mira and create-Vorne,
  // not patch-in-place, unlike a row-id-keyed diff. Kael's row is an untouched control — a
  // diff that force-nulls every baseline would wrongly emit a create for it too.
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

    // Retargets Mira's EXISTING row to Vorne — the divergent, swap-between-rows case.
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

    // Open in World on Kael's untouched row (Mira was retargeted above) before the reader trip:
    // World hasn't been visited in this spec yet, so the kind/id-dropping pop
    // (05b-peek-drawer.md:145) can't fire — GO TO resumes this same Plot instance. Runs before
    // the reader trip because that dismisses Plot outright (a pop unmounts what it pops past),
    // so anything after needs a fresh selection, not a resumed one.
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

  test('a cold-mount deep link preselects the row', async () => {
    const page = app.window
    // Prior test's undo dismissed Plot outright — fresh instance here, not a resumed one.
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
