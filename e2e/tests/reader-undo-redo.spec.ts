import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  parkClassifierWatermarkAtLastReply,
  removeUserDataDir,
  setClassifierCadence,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Reverse / re-apply a committed turn — the "regenerate / undo" alternative flow
// (there is no wired regenerate control; undo is the reversal path). Undo of a
// turn reverse-and-prunes its delta rows (the entries go with them); redo
// re-applies the snapshot. Asserted through the DB. See docs/testing.md → Coverage.
const REPLY = 'E2E-UNDO-REPLY the courier turns back into the rain.'

test.describe('reader — undo / redo a turn', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply (model-management.md → Embed failure is
    // blocking). Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(REPLY)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  async function replyCount(): Promise<number> {
    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    const rows = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-UNDO-REPLY%'`,
      [branchId],
    )
    return rows.length
  }

  test('undo reverses the committed turn; redo re-applies it', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-UNDO-USER I retreat a step.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-UNDO-REPLY', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    expect(await replyCount()).toBe(1)

    // Undo through the chrome actions menu (the touch-tier path; the keyboard
    // shortcut is intentionally inert while focus is in the composer).
    await reader.actionsTrigger(app.window).click()
    await reader.undoRow(app.window).click()
    await expect.poll(replyCount, { timeout: 15_000 }).toBe(0)

    // Redo re-applies the same turn — the row comes back.
    await reader.actionsTrigger(app.window).click()
    await reader.redoRow(app.window).click()
    await expect.poll(replyCount, { timeout: 15_000 }).toBe(1)
  })
})

// The survival anchor only bites when a classifier delta sits ABOVE the undone
// turn's create in log order while being anchored to an entry BELOW it. That
// arrangement needs a real pass whose window spans two turns, so only a running
// app produces it: the window is built from SQLite at pass time, the handles are
// minted there, and the reconciler stamps deltas.entry_id from sourceTurn.
// Unit fixtures hand-write that log; this proves the app actually creates it.
const SURVIVE_REPLY_A = 'E2E-SURVIVE-A the courier waters the horse at dawn.'
const SURVIVE_REPLY_B = 'E2E-SURVIVE-B the bridge groans underfoot.'
const FACT_A = 'The courier waters the horse at dawn'
const FACT_B = 'The bridge collapses behind the courier'

test.describe('reader — undo of a turn covered by a two-turn classifier pass', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  // Watermark parked at the last settled turn: every position above it is this spec's.
  let tip: number

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    // t1..t4 are the window's prose handles in ascending position: turn A's
    // user_action, turn A's reply, turn B's user_action, turn B's reply. The
    // delta's entry_id comes from sourceTurn (lib/classifier/plan.ts), so t2
    // anchors a fact to the SURVIVING turn and t4 to the undone one.
    mock.setStructured('periodic-classifier', {
      happenings: [
        { title: FACT_A, description: 'A quiet halt.', sourceTurn: 't2' },
        { title: FACT_B, description: 'Timbers give way.', sourceTurn: 't4' },
      ],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
    })
    setProviderEndpoint(seeded.dbPath, mock.url)
    // unprocessedTurnCount counts entry ROWS, not turn pairs: two turns are four
    // rows, so cadence 4 fires exactly one pass and only after turn B — the
    // single pass whose window covers both turns.
    setClassifierCadence(seeded.dbPath, 'story_hero', 4)
    tip = parkClassifierWatermarkAtLastReply(seeded.dbPath, 'br_hero_main')
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  async function branchId(): Promise<string> {
    return (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
  }

  async function happeningCount(branch: string, title: string): Promise<number> {
    return (
      await queryApp(
        app.window,
        `SELECT COUNT(*) FROM happenings WHERE branch_id = ? AND title = ?`,
        [branch, title],
      )
    )[0][0] as number
  }

  async function turnBEntryCount(branch: string): Promise<number> {
    return (
      await queryApp(
        app.window,
        `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-SURVIVE-B%'`,
        [branch],
      )
    )[0][0] as number
  }

  test('spares the classifier fact anchored to the surviving turn, clamps the watermark, and redo restores the unit', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    mock.setNarrative(SURVIVE_REPLY_A)
    await reader.composer(app.window).fill('E2E-SURVIVE-A I rest the horse.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-SURVIVE-A the courier', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    mock.setNarrative(SURVIVE_REPLY_B)
    await reader.composer(app.window).fill('E2E-SURVIVE-B I cross the bridge.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-SURVIVE-B the bridge', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    const branch = await branchId()
    await expect
      .poll(() => mock.requests.some((r) => r.agent === 'periodic-classifier'), { timeout: 30_000 })
      .toBe(true)
    await expect.poll(() => happeningCount(branch, FACT_A), { timeout: 30_000 }).toBe(1)
    await expect.poll(() => happeningCount(branch, FACT_B), { timeout: 30_000 }).toBe(1)

    // Exactly one pass: two passes would each see a one-turn window, and t2/t4
    // would resolve by head-fallback instead of to the turns this spec means.
    expect(mock.requests.filter((r) => r.agent === 'periodic-classifier')).toHaveLength(1)

    // The four rows this spec committed, ascending: A_user, A_reply, B_user, B_reply.
    const rows = await queryApp(
      app.window,
      `SELECT id, position FROM story_entries WHERE branch_id = ? AND position > ? ORDER BY position`,
      [branch, tip],
    )
    expect(rows).toHaveLength(4)
    const aReplyPosition = rows[1][1] as number
    const bUserPosition = rows[2][1] as number

    // Precondition, not the assertion under test: the fixture is only meaningful
    // if the two facts really landed on opposite sides of turn B's start, and
    // both above it in the log. A head-fallback would put them both on B.
    const anchors = await queryApp(
      app.window,
      `SELECT h.title, e.position, d.log_position FROM deltas d
         JOIN happenings h ON h.branch_id = d.branch_id AND h.id = d.target_id
         JOIN story_entries e ON e.branch_id = d.branch_id AND e.id = d.entry_id
        WHERE d.branch_id = ? AND d.target_table = 'happenings' AND h.title IN (?, ?)`,
      [branch, FACT_A, FACT_B],
    )
    expect(anchors).toHaveLength(2)
    const anchorFor = (title: string) => anchors.find((r) => r[0] === title)!
    expect(anchorFor(FACT_A)[1]).toBe(aReplyPosition)
    expect(anchorFor(FACT_B)[1]).toBeGreaterThanOrEqual(bUserPosition)

    const createLogPosition = (
      await queryApp(
        app.window,
        `SELECT log_position FROM deltas WHERE branch_id = ? AND target_table = 'story_entries'
           AND op = 'create' AND target_id = ?`,
        [branch, rows[2][0] as string],
      )
    )[0][0] as number
    // Both facts sit above turn B's create — the whole point: a bare suffix
    // sweep would take the surviving turn's fact down with the undone turn.
    expect(anchorFor(FACT_A)[2]).toBeGreaterThan(createLogPosition)

    await reader.actionsTrigger(app.window).click()
    await reader.undoRow(app.window).click()
    await expect.poll(() => turnBEntryCount(branch), { timeout: 15_000 }).toBe(0)

    // The fact anchored to the undone turn goes; the lagging fact about the
    // surviving turn stays, despite sitting higher in the log.
    expect(await happeningCount(branch, FACT_B)).toBe(0)
    expect(await happeningCount(branch, FACT_A)).toBe(1)

    // processedThrough clamps to position(B) - 1 so the next pass re-covers B.
    const watermark = await queryApp(
      app.window,
      `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
      [branch],
    )
    expect(watermark[0][0]).toBe(bUserPosition - 1)

    // Redo restores the whole unit — the turn and its B-anchored fact.
    await reader.actionsTrigger(app.window).click()
    await reader.redoRow(app.window).click()
    await expect.poll(() => turnBEntryCount(branch), { timeout: 15_000 }).toBe(2)
    expect(await happeningCount(branch, FACT_B)).toBe(1)
    expect(await happeningCount(branch, FACT_A)).toBe(1)
  })
})
