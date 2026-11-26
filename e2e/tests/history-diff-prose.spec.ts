import { expect, test, type Page } from '@playwright/test'

import { passProbe } from '../flows/classifier-pass'
import { goToPlot, goToReader, goToWorld, openStory, undoFromReader } from '../flows/navigation'
import { takeTurn } from '../flows/turn'
import { currentBranchId, entityState, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { promptOf, startMockLlm, type MockLlm } from '../harness/mock-llm'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import {
  createSeededUserDataDir,
  parkClassifierWatermarkAtLastReply,
  removeUserDataDir,
  seedClassifierBacklog,
  setChapterAutoClose,
  setClassifierCadence,
  setProviderEndpoint,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { plot } from '../locators/plot'
import { reader, undoText } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

// world.md → Change prose. Unit and story tests own the wording; this spec drives real edits,
// undos and redos through the UI, asserting each write in the DB before the row's prose.
const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

/** One free-text clause, through the keys the app renders it with. */
function textChange(field: string, before: string, after: string): string {
  const quoted = (text: string) => t('history:prose.quoted', { text })
  return t('history:prose.clause', {
    field: t(`history:field.${field}`),
    change: t('history:prose.changed', { old: quoted(before), new: quoted(after) }),
  })
}

// GO TO World from the reader pushes a fresh World (going to the reader popped the last one,
// use-surface-navigate.ts), so each visit opens its row again.
async function openWorldRow(
  page: Page,
  category: 'character' | 'faction',
  name: string,
  tab: 'identity' | 'history',
): Promise<void> {
  await goToWorld(page)
  await world.categoryTrigger(page).click()
  await world.categoryOption(page, category).click()
  await world.row(page, name).click()
  await world.tab(page, tab).click()
}

/** The reader's Actions menu Undo row, CTRL-Z's touch-tier twin; an unseen target asks first. */
async function undoInReader(page: Page, label: string, confirmTitle?: string): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await reader.undoRow(page, label).click()
  if (confirmTitle === undefined) return
  await expect(reader.undoConfirm(page, confirmTitle)).toBeVisible()
  await reader.undoConfirmUndo(page).click()
}

// The pass's prompt lists rows as `- [<placeholder>] <name>`
// (lib/prompts/bundled/periodic-classifier.ts), so a reply can name them once the call is held.
function placeholderIn(prompt: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^\\s*- \\[([a-z]+\\d+)\\] ${escaped}(?= \\(| —|$)`, 'm').exec(prompt)
  if (match === null) throw new Error(`the pass's prompt lists no "${name}"`)
  return match[1]
}

test.describe.serial('History diff prose — edits, undo and redo', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let branchId: string
  let kael: string
  let seededHair: string
  const HAIR_FIRST = 'E2E-HAIR silver-streaked'
  const HAIR_SECOND = 'E2E-HAIR white'
  const THREAD = 'What the amulet wants'
  const PLOT_FIRST = 'E2E-PLOT the amulet hums'
  const PLOT_SECOND = 'E2E-PLOT the amulet sings'

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  async function hair(): Promise<unknown> {
    const state = await entityState(app.window, branchId, kael)
    return (state?.visual as { hair?: unknown } | undefined)?.hair
  }

  async function saveHair(value: string): Promise<void> {
    await world.visualField(app.window, 'hair').fill(value)
    await saveSession.saveBarSave(app.window).click()
    await expect(saveSession.saveBarSave(app.window)).toHaveCount(0)
    await expect.poll(hair, { timeout: 15_000 }).toBe(value)
  }

  const hairRow = (before: string, after: string) =>
    world.historyRows(app.window).filter({ hasText: textChange('hair', before, after) })

  test("a World edit shows its before and after in the row's History", async () => {
    const page = app.window
    await openStory(page, HERO_TITLE)
    branchId = await currentBranchId(page, HERO_STORY)
    const [[id]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ? AND name = 'Kael'`,
      [branchId],
    )
    kael = id as string
    seededHair = (await hair()) as string

    await openWorldRow(page, 'character', 'Kael', 'identity')
    await saveHair(HAIR_FIRST)
    await saveHair(HAIR_SECOND)

    await world.tab(page, 'history').click()
    await expect(hairRow(seededHair, HAIR_FIRST)).toHaveCount(1, { timeout: 15_000 })
    await expect(hairRow(HAIR_FIRST, HAIR_SECOND)).toHaveCount(1, { timeout: 15_000 })
  })

  test('CTRL-Z from the reader, then Redo, leave History showing the right values', async () => {
    const page = app.window
    await undoFromReader(
      page,
      undoText('menu', 'edited', { name: 'Kael' }),
      undoText('title', 'edited', { name: 'Kael' }),
    )
    await expect.poll(hair, { timeout: 30_000 }).toBe(HAIR_FIRST)
    await openWorldRow(page, 'character', 'Kael', 'history')
    await expect(hairRow(seededHair, HAIR_FIRST)).toHaveCount(1, { timeout: 15_000 })
    await expect(world.historyRows(page).filter({ hasText: HAIR_SECOND })).toHaveCount(0)

    await goToReader(page)
    await chrome.actionsTrigger(page).click()
    await reader.redoRow(page, undoText('redoMenu', 'edited', { name: 'Kael' })).click()
    await expect.poll(hair, { timeout: 30_000 }).toBe(HAIR_SECOND)
    await openWorldRow(page, 'character', 'Kael', 'history')
    await expect(hairRow(HAIR_FIRST, HAIR_SECOND)).toHaveCount(1, { timeout: 15_000 })
    await expect(hairRow(seededHair, HAIR_FIRST)).toHaveCount(1, { timeout: 15_000 })
  })

  test("a thread edit in Plot shows its before and after in the thread's History", async () => {
    const page = app.window
    const [[threadId]] = await queryApp(
      page,
      `SELECT id FROM threads WHERE branch_id = ? AND title = ?`,
      [branchId, THREAD],
    )
    const description = async () =>
      (
        await queryApp(page, `SELECT description FROM threads WHERE branch_id = ? AND id = ?`, [
          branchId,
          threadId,
        ])
      )[0][0]

    await goToPlot(page)
    await plot.segmentCell(page, 'thread').click()
    await plot.row(page, THREAD).click()
    await plot.tab(page, 'overview').click()
    // Two short texts: the second save's prose is canon's whole-text case, with no cut.
    for (const text of [PLOT_FIRST, PLOT_SECOND]) {
      await plot.description(page).fill(text)
      await saveSession.saveBarSave(page).click()
      await expect(saveSession.saveBarSave(page)).toHaveCount(0)
      await expect.poll(description, { timeout: 15_000 }).toBe(text)
    }

    await plot.tab(page, 'history').click()
    await expect(
      plot
        .historyRows(page)
        .filter({ hasText: textChange('description', PLOT_FIRST, PLOT_SECOND) }),
    ).toHaveCount(1, { timeout: 15_000 })
  })
})

// A survivor: a later write the edit's undo spares, its prior rewritten. Only a pass anchored
// below the turn it rides survives that turn's undo, so it reads a reply reworded after the edit.
test.describe('History diff prose — a pass write that survives the undo of the edit under it', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  const HERO_BRANCH = 'br_hero_main'
  const WATCH = 'The City Watch'
  const USER_STANDING = 'E2E-USER uneasy allies'
  const PASS_STANDING = 'E2E-PASS sworn to the Watch'
  const REWORDED = 'E2E-SURVIVOR the courier counts the Watch-house doors twice.'
  const ACTION = 'E2E-SURVIVOR-U I ask the sergeant where the Watch stands.'
  const REPLY = 'E2E-SURVIVOR-R The sergeant swears the Watch to the courier.'

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    // Window opens on the reply before the last turn: three rows now, five after one turn, so
    // cadence 5 makes the pass due after that turn only. Count 0 appends no filler, just re-parks.
    const lastReply = parkClassifierWatermarkAtLastReply(seeded.dbPath, HERO_BRANCH)
    seedClassifierBacklog(seeded.dbPath, HERO_BRANCH, 0, lastReply - 3)
    setClassifierCadence(seeded.dbPath, HERO_STORY, 5)
    // An owed close would run a pass at Send, before the turn.
    setChapterAutoClose(seeded.dbPath, HERO_STORY, false)
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  const { passCalls, heldPass, runOutcome } = passProbe(
    () => app.window,
    () => mock,
  )

  const watchRow = (page: Page, before: string, after: string) =>
    world.historyRows(page).filter({ hasText: textChange('standing', before, after) })

  test('CTRL-Z of the edit rewrites the surviving pass write in History; Redo restores it', async () => {
    test.setTimeout(180_000)
    const page = app.window
    await openStory(page, HERO_TITLE)
    expect(await currentBranchId(page, HERO_STORY)).toBe(HERO_BRANCH)
    const [[watchId]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ? AND name = ?`,
      [HERO_BRANCH, WATCH],
    )
    const watch = watchId as string
    const standing = async () => (await entityState(page, HERO_BRANCH, watch))?.standing
    const original = (await standing()) as string
    const userEdits = async () =>
      (
        await queryApp(
          page,
          `SELECT COUNT(*) FROM deltas WHERE branch_id = ? AND target_id = ? AND source = 'user_edit'`,
          [HERO_BRANCH, watch],
        )
      )[0][0]

    // Precondition, not the assertion under test: the window opens on a reply below the head
    // turn. A seed change that moves it must fail here, not pass with no survivor.
    const [[processedThrough]] = await queryApp(
      page,
      `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
      [HERO_BRANCH],
    )
    const windowRows = await queryApp(
      page,
      `SELECT id, position, kind, content FROM story_entries
       WHERE branch_id = ? AND position > ? AND kind <> 'system' ORDER BY position`,
      [HERO_BRANCH, processedThrough],
    )
    expect(windowRows.map((row) => row[2])).toEqual(['ai_reply', 'user_action', 'ai_reply'])
    const [editedId, editedAt, , editedContent] = windowRows[0] as [string, number, string, string]
    const content = async () =>
      (await queryApp(page, `SELECT content FROM story_entries WHERE id = ?`, [editedId]))[0][0]

    // The World edit the third undo takes.
    await openWorldRow(page, 'faction', WATCH, 'identity')
    await world.standingField(page).fill(USER_STANDING)
    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)
    await expect.poll(standing, { timeout: 15_000 }).toBe(USER_STANDING)
    expect(await userEdits()).toBe(1)

    // Reword the window's first reply after the edit: below the head turn it records no
    // invalidation scope, and its prose now postdates the edit, so the pass's write on it lands.
    await goToReader(page)
    await reader.row(page, editedId).scrollIntoViewIfNeeded()
    await reader.editEntry(page, editedId).click()
    await reader.editTextarea(page).fill(REWORDED)
    await reader.saveEdit(page).click()
    await expect(reader.editTextarea(page)).toHaveCount(0)
    await expect.poll(content, { timeout: 15_000 }).toBe(REWORDED)

    // One turn brings the pass due; it sets the standing from that reply, t1.
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()
    mock.setNarrative(REPLY)
    await takeTurn(page, ACTION, 'E2E-SURVIVOR-R')
    const pass = await heldPass(calls)
    const held = mock.requests.filter((r) => r.agent === 'periodic-classifier').at(-1)
    if (held === undefined) throw new Error('the held pass call was not recorded')
    mock.setStructured('periodic-classifier', {
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
      newFactions: [],
      memberships: [],
      standings: [
        { ref: placeholderIn(promptOf(held), WATCH), standing: PASS_STANDING, sourceTurn: 't1' },
      ],
    })
    mock.releaseStructured()
    await expect.poll(() => runOutcome(pass), { timeout: 30_000 }).toBe('completed')
    await expect.poll(standing, { timeout: 15_000 }).toBe(PASS_STANDING)
    const passWrites = await queryApp(
      page,
      `SELECT id, entry_id, json_extract(undo_payload, '$.state.standing') FROM deltas
       WHERE action_id = ? AND target_id = ?`,
      [pass, watch],
    )
    expect(passWrites).toEqual([[expect.any(String), editedId, USER_STANDING]])
    const survivor = passWrites[0][0] as string
    const survivorPrior = async () =>
      (
        await queryApp(
          page,
          `SELECT json_extract(undo_payload, '$.state.standing') FROM deltas WHERE id = ?`,
          [survivor],
        )
      )[0]?.[0]

    // History reads both writes, which caches the pass's entry.
    await openWorldRow(page, 'faction', WATCH, 'history')
    await expect(watchRow(page, USER_STANDING, PASS_STANDING)).toHaveCount(1, { timeout: 15_000 })
    await expect(watchRow(page, original, USER_STANDING)).toHaveCount(1, { timeout: 15_000 })

    // CTRL-Z three times: the turn, the reply's rewording, the World edit. The pass's write
    // survives each; the last rewrites its prior.
    const [[turnAt]] = await queryApp(
      page,
      `SELECT position FROM story_entries WHERE branch_id = ? AND content = ?`,
      [HERO_BRANCH, ACTION],
    )
    await goToReader(page)
    await undoInReader(page, undoText('menu', 'turn', { entry: turnAt as number }))
    await expect
      .poll(
        async () =>
          (
            await queryApp(
              page,
              `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND content LIKE 'E2E-SURVIVOR-%'`,
              [HERO_BRANCH],
            )
          )[0][0],
        { timeout: 15_000 },
      )
      .toBe(0)
    expect(await survivorPrior()).toBe(USER_STANDING)

    await undoInReader(page, undoText('menu', 'entryText', { entry: editedAt }))
    await expect.poll(content, { timeout: 15_000 }).toBe(editedContent)
    expect(await survivorPrior()).toBe(USER_STANDING)

    await undoInReader(
      page,
      undoText('menu', 'edited', { name: WATCH }),
      undoText('title', 'edited', { name: WATCH }),
    )
    await expect.poll(userEdits, { timeout: 30_000 }).toBe(0)
    expect(await survivorPrior()).toBe(original)
    expect(await standing()).toBe(PASS_STANDING)

    // The survivor's rewritten prior, read through the evicted cache.
    await openWorldRow(page, 'faction', WATCH, 'history')
    await expect(watchRow(page, original, PASS_STANDING)).toHaveCount(1, { timeout: 15_000 })
    await expect(world.historyRows(page).filter({ hasText: USER_STANDING })).toHaveCount(0)

    // Redo puts the edit back, and the survivor's original prior with it.
    await goToReader(page)
    await chrome.actionsTrigger(page).click()
    await reader.redoRow(page, undoText('redoMenu', 'edited', { name: WATCH })).click()
    await expect.poll(survivorPrior, { timeout: 30_000 }).toBe(USER_STANDING)
    await openWorldRow(page, 'faction', WATCH, 'history')
    await expect(watchRow(page, USER_STANDING, PASS_STANDING)).toHaveCount(1, { timeout: 15_000 })
    await expect(watchRow(page, original, USER_STANDING)).toHaveCount(1, { timeout: 15_000 })
  })
})
