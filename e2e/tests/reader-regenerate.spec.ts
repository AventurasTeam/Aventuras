import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Regenerate a reply: the ↻ glyph reverses the reply's turn through the shared
// C3 sweep, then re-runs the per-turn pipeline against the surviving
// user_action under a fresh action_id (lib/actions/turns/regenerate-turn.ts).
// A terminal reply (counts.entries === 1) dispatches immediately; an older
// reply first surfaces RollbackConfirmModal (variant="regenerate") because
// reversing it also takes later turns with it. Both paths asserted through
// the DB. See docs/testing.md → Coverage.
//
// Test 2 builds on test 1's committed state, so the describe below forces
// mode: 'serial' — workers:1 + fullyParallel:false only order the tests;
// retries:1 starts a *new worker* per attempt (fresh beforeAll → a freshly
// reseeded DB), and without 'serial' a retried test 1 would leave test 2
// running against that fresh DB instead of being skipped.
const REPLY_1 = 'E2E-REGEN-R1 the courier reads the letter twice.'
const REPLY_2 = 'E2E-REGEN-R2 the courier burns the letter unread.'
const REPLY_3 = 'E2E-REGEN-R3 the courier hides the letter in a boot.'
const REPLY_4 = 'E2E-REGEN-R4 the letter names a city that no longer exists.'
const EDITED_ACTION = 'E2E-REGEN-U3 I open the satchel and read the letter aloud.'

test.describe('reader — regenerate a reply', () => {
  test.describe.configure({ mode: 'serial' })

  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply. Cold cache downloads ~24 MB from
    // Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(REPLY_1)
    setProviderEndpoint(seeded.dbPath, mock.url)
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

  // per-turn.ts yields stream_chunk during streaming and the reader renders it
  // live, so the DOM text a caller just awaited can resolve off the stream
  // buffer while the row (and its create delta) are still mid-commit in a
  // later transaction. Callers poll this rather than reading it once. The
  // cardinality assert is the other half: no ORDER BY / LIMIT means a
  // regression that duplicated a row would otherwise still satisfy a bare
  // presence/absence check.
  async function entryIdByContent(branch: string, marker: string): Promise<string | undefined> {
    const rows = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE ?`,
      [branch, `%${marker}%`],
    )
    expect(rows.length, `${marker} row count`).toBeLessThanOrEqual(1)
    return rows[0]?.[0] as string | undefined
  }

  // Poll until the marker's row exists, then hand back its id. The extra read
  // after the poll settles is safe (no further write can race it — the poll
  // already proved the row committed) and avoids threading a resolved value
  // out of expect.poll, which only returns the assertion's pass/fail.
  async function pollEntryId(branch: string, marker: string): Promise<string> {
    await expect.poll(() => entryIdByContent(branch, marker), { timeout: 15_000 }).toBeDefined()
    const id = await entryIdByContent(branch, marker)
    if (id === undefined) throw new Error(`${marker}: present at the poll, gone on read-back`)
    return id
  }

  async function pollEntryGone(branch: string, marker: string): Promise<void> {
    await expect.poll(() => entryIdByContent(branch, marker), { timeout: 15_000 }).toBeUndefined()
  }

  async function createActionId(branch: string, entryId: string): Promise<string> {
    const rows = await queryApp(
      app.window,
      `SELECT action_id FROM deltas WHERE branch_id = ? AND target_table = 'story_entries'
         AND op = 'create' AND target_id = ?`,
      [branch, entryId],
    )
    // A bare rows[0][0] throws TypeError on an empty result — a real miss (or
    // the same stream-buffer race entryIdByContent guards against) should fail
    // as a named assertion, not a cryptic "Cannot read properties of undefined".
    expect(rows.length, `create delta for entry ${entryId}`).toBe(1)
    return rows[0][0] as string
  }

  test('terminal reply regenerates with no confirm: fresh action_id, user action untouched', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-REGEN-U1 I open the satchel.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-REGEN-R1', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    const branch = await branchId()
    // Polled: proves both rows landed (and are singular) before regenerate
    // acts on them — otherwise the "gone" / "untouched" assertions below
    // would be vacuous.
    const oldReplyId = await pollEntryId(branch, 'E2E-REGEN-R1')
    const userActionId = await pollEntryId(branch, 'E2E-REGEN-U1')
    const userActionActionId = await createActionId(branch, userActionId)

    mock.setNarrative(REPLY_2)
    await reader.regenEntry(app.window, oldReplyId).click()
    // The new take arriving with no click on a confirm IS the no-confirm claim:
    // the modal gates the dispatch, so R2 could not stream past an open one.
    await expect(app.window.getByText('E2E-REGEN-R2', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    // Asserted after that wait, not before it. Checked straight after the click
    // it passes at t≈0 against a locator that has not resolved yet — the
    // dispatch is a full IPC round trip away — so it proved nothing there.
    await expect(reader.regenerateConfirm(app.window)).toHaveCount(0)

    // Old take gone; the originating user action untouched (same row id).
    await pollEntryGone(branch, 'E2E-REGEN-R1')
    expect(await entryIdByContent(branch, 'E2E-REGEN-U1')).toBe(userActionId)

    // The new take rides a fresh turn action_id, not the original group's.
    const newReplyId = await pollEntryId(branch, 'E2E-REGEN-R2')
    expect(await createActionId(branch, newReplyId)).not.toBe(userActionActionId)
  })

  test('older reply surfaces the cascade confirm, then regenerates from that turn', async () => {
    const branch = await branchId()
    // Second turn on top of the regenerated first turn (log: U1, R2 → + U2, R3).
    mock.setNarrative(REPLY_3)
    await reader.composer(app.window).fill('E2E-REGEN-U2 I follow the river.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-REGEN-R3', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    // Polled: proves the second turn actually committed before the cascade
    // removes it — otherwise the U2/R3-gone assertions below would be vacuous.
    const olderReplyId = await pollEntryId(branch, 'E2E-REGEN-R2')
    await pollEntryId(branch, 'E2E-REGEN-U2')
    await pollEntryId(branch, 'E2E-REGEN-R3')
    // Captured before the cascade: "U1 survives" is a claim about the row, and
    // a re-created row carrying the same marker would satisfy mere presence.
    const userActionId = await pollEntryId(branch, 'E2E-REGEN-U1')

    mock.setNarrative(REPLY_1)
    await reader.regenEntry(app.window, olderReplyId).click()

    // Cascade path: the confirm modal gates the deeper reversal.
    await expect(reader.regenerateConfirm(app.window)).toBeVisible({ timeout: 10_000 })
    await reader.regenerateConfirm(app.window).click()
    await expect(app.window.getByText('E2E-REGEN-R1', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    // The re-dispatch half committed, not just streamed to the DOM — doubles
    // as a commit barrier for the sweep the negative assertions below rely on.
    await pollEntryId(branch, 'E2E-REGEN-R1')

    // The cascade removed the old take AND the later turn; U1 survives.
    await pollEntryGone(branch, 'E2E-REGEN-R2')
    await pollEntryGone(branch, 'E2E-REGEN-U2')
    await pollEntryGone(branch, 'E2E-REGEN-R3')
    expect(await entryIdByContent(branch, 'E2E-REGEN-U1')).toBe(userActionId)
  })

  // `Save & regenerate` on the head turn's action. The claim no cheaper layer
  // can make: the run reads its prompt from the branch tail, so the commit has
  // to land first for the new take to answer the edited text rather than the
  // text it replaced.
  test('save and regenerate re-answers the edited action', async () => {
    const branch = await branchId()
    const userActionId = await pollEntryId(branch, 'E2E-REGEN-U1')
    await pollEntryId(branch, 'E2E-REGEN-R1')

    mock.setNarrative(REPLY_4)
    const before = mock.requests.length
    await reader.row(app.window, userActionId).scrollIntoViewIfNeeded()
    await reader.editEntry(app.window, userActionId).click()
    await reader.editTextarea(app.window).fill(EDITED_ACTION)
    await reader.saveAndRegenEdit(app.window).click()

    await expect(app.window.getByText('E2E-REGEN-R4', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    // The edit rewrote the standing row rather than creating one, and the take
    // it diverged from is gone.
    expect(await entryIdByContent(branch, 'E2E-REGEN-U3')).toBe(userActionId)
    await pollEntryGone(branch, 'E2E-REGEN-R1')
    await pollEntryId(branch, 'E2E-REGEN-R4')

    // One generation, and it saw the edit. A commit ordered after the dispatch
    // would still satisfy every assertion above.
    const streamed = mock.requests.slice(before).filter((r) => r.streamed)
    expect(streamed.length, 'narrative calls').toBe(1)
    const prompt = JSON.stringify(streamed[0].body)
    expect(prompt).toContain('E2E-REGEN-U3')
    expect(prompt).not.toContain('E2E-REGEN-U1')
  })
})
