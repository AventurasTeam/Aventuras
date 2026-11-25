import { expect, test, type Page } from '@playwright/test'

import { goToReader, goToWorld, openStory, openWorld, undoFromReader } from '../flows/navigation'
import { takeTurn } from '../flows/turn'
import { currentBranchId, queryApp, queryScalar } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import {
  createSeededUserDataDir,
  flagSeededLead,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { reader, undoText } from '../locators/reader'
import { world } from '../locators/world'

// data-model.md → The lead, at the seams only a running app reaches: World's set and the reader's
// undo of it, the lead's delete, the reader refusing a turn without one, the stamps on the next
// turn, and a merge that keeps the lead's row. Units and stories carry the rest.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'
// Entry ids aren't substitutable, so the seeded tail's stay mnemonic.
const LAST_REPLY = 'entry_hero_0071'
const SYSTEM_TAIL = 'entry_hero_0072'
const DRAFT = 'E2E-LEAD-DRAFT I wait at the gate.'
const ACTION = 'E2E-LEAD-ACTION I knock twice.'
const REPLY_MARKER = 'E2E-LEAD-REPLY'

// Seeded ids under a substitutable prefix are remapped (testing.md → Substitutable IDs): by name.
async function entityId(page: Page, branchId: string, name: string): Promise<string> {
  const rows = await queryApp(page, `SELECT id FROM entities WHERE branch_id = ? AND name = ?`, [
    branchId,
    name,
  ])
  if (rows.length !== 1) throw new Error(`expected one ${name} on ${branchId}: ${rows.length}`)
  return rows[0]![0] as string
}

async function leadNames(page: Page, branchId: string): Promise<string[]> {
  const rows = await queryApp(
    page,
    `SELECT name FROM entities WHERE branch_id = ? AND is_lead = 1 ORDER BY name`,
    [branchId],
  )
  return rows.map(([name]) => name as string)
}

function logHead(page: Page, branchId: string): Promise<number> {
  return queryScalar(
    page,
    `SELECT COALESCE(MAX(log_position), 0) FROM deltas WHERE branch_id = ?`,
    [branchId],
  )
}

async function setLeadInWorld(page: Page, name: string): Promise<void> {
  await goToWorld(page)
  await world.categoryTrigger(page).click()
  await world.categoryOption(page, 'character').click()
  await world.row(page, name).click()
  await world.moreActions(page).click()
  await world.menuItem(page, 'setLead').click()
}

// Serial suite, one app: each test starts where the last left the branch's lead.
test.describe.serial('Per-branch lead', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let branchId: string

  test.beforeAll(async () => {
    // A turn needs the mock LLM and an installed embedder; the model copy dominates.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(`${REPLY_MARKER} the gate swings open.`)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('Set as lead flags Mira in one group, and the reader undoes it by name', async () => {
    const page = app.window
    await openStory(page, HERO_TITLE)
    branchId = await currentBranchId(page, HERO_STORY)
    expect(await leadNames(page, branchId)).toEqual(['Kael'])
    const kael = await entityId(page, branchId, 'Kael')
    const mira = await entityId(page, branchId, 'Mira')
    const head = await logHead(page, branchId)

    await setLeadInWorld(page, 'Mira')

    await expect.poll(() => leadNames(page, branchId), { timeout: 15_000 }).toEqual(['Mira'])
    // data-model.md → The lead: a set clears every flagged row, then flags the new lead, one group.
    const written = await queryApp(
      page,
      `SELECT target_id, action_id FROM deltas WHERE branch_id = ? AND log_position > ?
        ORDER BY log_position`,
      [branchId, head],
    )
    expect(written.map(([target]) => target)).toEqual([kael, mira])
    expect(new Set(written.map(([, actionId]) => actionId)).size).toBe(1)

    await undoFromReader(
      page,
      undoText('menu', 'leadSet', { name: 'Mira' }),
      undoText('title', 'leadSet', { name: 'Mira' }),
    )
    await expect.poll(() => leadNames(page, branchId), { timeout: 30_000 }).toEqual(['Kael'])
  })

  test('deleting the lead names the needs-a-lead line, and leaves the branch with none', async () => {
    const page = app.window
    await goToWorld(page)
    await world.row(page, 'Kael').click()
    await world.moreActions(page).click()
    await world.deleteEntityItem(page).click()
    await expect(
      world
        .deleteDialog(page)
        .getByText(t('world:delete.leadNeeded', { name: 'Kael' }), { exact: false }),
    ).toBeVisible()
    await world.deleteConfirm(page, 'character').click()

    await expect.poll(() => leadNames(page, branchId), { timeout: 15_000 }).toEqual([])
    expect(
      await queryScalar(page, `SELECT count(*) FROM entities WHERE branch_id = ? AND name = ?`, [
        branchId,
        'Kael',
      ]),
    ).toBe(0)
  })

  test('with the lead missing, Send and ↻ dispatch nothing: draft, tail and reply stay', async () => {
    const page = app.window
    await goToReader(page)
    const userActions = () =>
      queryScalar(
        page,
        `SELECT count(*) FROM story_entries WHERE branch_id = ? AND kind = 'user_action'`,
        [branchId],
      )
    const tailRows = () =>
      queryScalar(page, `SELECT count(*) FROM story_entries WHERE branch_id = ? AND id IN (?, ?)`, [
        branchId,
        LAST_REPLY,
        SYSTEM_TAIL,
      ])
    const actionsBefore = await userActions()
    const head = await logHead(page, branchId)
    const reason = t('reader:composerLeadMissing')
    await expect(reader.leadMissingLine(page)).toBeVisible()

    await reader.composer(page).fill(DRAFT)
    await expect(reader.send(page)).toBeDisabled()
    // A press dispatched past the disabled state: Send must still refuse it.
    await reader.send(page).dispatchEvent('click')
    // The composer clears synchronously on a Send that goes out, so this fails fast if one did.
    await expect(reader.composer(page)).toHaveValue(DRAFT)
    await expect(reader.leadMissingLine(page)).toBeVisible()

    const regenerate = reader.gatedEntryAction(page, LAST_REPLY, reason)
    await expect(regenerate).toBeDisabled()
    await regenerate.dispatchEvent('click')
    // × rolls back, which starts no turn; the seeded tail's Retry would resubmit one.
    await expect(reader.deleteEntry(page, LAST_REPLY)).toBeEnabled()
    await expect(reader.retrySystemEntry(page)).toBeDisabled()

    expect(await userActions()).toBe(actionsBefore)
    expect(await tailRows()).toBe(2)
    expect(await logHead(page, branchId)).toBe(head)
    await expect(reader.composer(page)).toHaveValue(DRAFT)
  })

  test('a lead set again lets Send through, and the turn stamps it on both entries', async () => {
    const page = app.window
    await setLeadInWorld(page, 'Mira')
    await expect.poll(() => leadNames(page, branchId), { timeout: 15_000 }).toEqual(['Mira'])
    const mira = await entityId(page, branchId, 'Mira')
    await goToReader(page)
    await expect(reader.leadMissingLine(page)).toHaveCount(0)

    await takeTurn(page, ACTION, REPLY_MARKER)

    const stamps = () =>
      queryApp(
        page,
        `SELECT kind, json_extract(metadata, '$.leadId') FROM story_entries
          WHERE branch_id = ? AND (content LIKE ? OR content LIKE ?) ORDER BY position`,
        [branchId, '%E2E-LEAD-ACTION%', `%${REPLY_MARKER}%`],
      )
    await expect.poll(stamps, { timeout: 30_000 }).toEqual([
      ['user_action', mira],
      ['ai_reply', mira],
    ])
  })
})

// A launch of its own: the pair's newer row is the lead from the start, as no in-app write makes it.
test.describe('Per-branch lead — a merge keeps the lead row', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    flagSeededLead(seeded.dbPath, HERO_BRANCH, { name: 'Brannoc', newest: true })
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('Merge with the picker untouched keeps the newer row, still flagged, and removes the older', async () => {
    const page = app.window
    await openWorld(page, HERO_TITLE)
    const branchId = await currentBranchId(page, HERO_STORY)
    const brannocs = async () =>
      (
        await queryApp(
          page,
          `SELECT id, is_lead FROM entities WHERE branch_id = ? AND name = 'Brannoc'
            ORDER BY created_at`,
          [branchId],
        )
      ).map(([id, flag]) => [id as string, Number(flag)])
    const before = await brannocs()
    expect(before.map(([, flag]) => flag)).toEqual([0, 1])
    const newer = before[1]![0]
    expect(await leadNames(page, branchId)).toEqual(['Brannoc'])

    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'character').click()
    await world.resolveButton(page).click()
    // The held row is the fixed canonical: Merge names the newer row, whatever the default age.
    await world.mergeConfirm(page, 'newer', 'Brannoc').click()

    await expect.poll(brannocs, { timeout: 15_000 }).toEqual([[newer, 1]])
    expect(await leadNames(page, branchId)).toEqual(['Brannoc'])
  })
})
