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
// GO TO (useSurfaceNavigate) matches stack entries on path only and either pops back onto an
// existing match or pushes a new instance — a pop DISMISSES whatever it pops past, unmounting
// it for good, so returning to a screen that was popped past means a fresh instance, not a
// resumed one. Test 6 depends on this: test 5's cold-mount reload leaves Plot as the stack's
// sole entry, so the reader trip at test 5's end pushes a NEW reader on top rather than
// dismissing Plot, and test 6's GO TO back to Plot resumes that same, still-mounted instance.
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
    // hap_pact anchors on entry 59 (lib/db/devtools/seed-dataset.ts), a real open-region entry,
    // so Current isn't empty.
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

  // The headline invariant (save-happening.ts: "row plus involvement and awareness changes as
  // one action_id; undo reverses the whole Save") needs a draft that dirties BOTH the row and a
  // link, and a link edit that a row-id-keyed diff would resolve differently than the natural-key
  // diff happening-draft.ts actually uses. Retargeting an EXISTING row's character (Mira -> Vorne)
  // is that case: natural-key diffing reads it as a delete of Mira's committed row plus a create
  // for Vorne (awarenessByCharacter is keyed on characterId, with no id fallback), where an
  // id-keyed diff would instead patch Mira's row in place. Kael's row is left untouched as a
  // control — a diff that force-nulls every baseline would wrongly emit a create for it too.
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

    // Open in World (cross-route seam), before the reader trip below: the happening pane's
    // row-scoped icon action, on Kael's row — the one left untouched (Mira's row is retargeted
    // away above, so it no longer names her). World isn't already lower in the stack — this
    // spec has never visited it before — so the known kind/id-dropping pop
    // (05b-peek-drawer.md:145) can't fire here. GO TO pops back onto this SAME Plot instance
    // (only World was pushed on top of it), which is why this round trip runs before the
    // reader trip: going to the reader dismisses Plot outright (a stack pop unmounts what it
    // pops past), so anything after that needs a fresh selection rather than a resumed one.
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
    // The previous test ends on the reader (its own undo trip dismisses Plot outright), so
    // this starts with a fresh Plot instance rather than assuming one survived.
    await reader.actionsTrigger(page).click()
    await plot.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)

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
