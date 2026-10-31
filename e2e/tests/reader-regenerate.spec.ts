import { expect, test } from '@playwright/test'

import { currentBranchId, entryIdOf, pollEntryIdOf, queryApp } from '../harness/db'
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
// Each test builds on the one before's state, hence 'serial': workers:1 only orders tests, and
// a retry's new worker reseeds the DB, which a later test would then run on instead of skipping.
const REPLY_1 = 'E2E-REGEN-R1 the courier reads the letter twice.'
const REPLY_2 = 'E2E-REGEN-R2 the courier burns the letter unread.'
const REPLY_3 = 'E2E-REGEN-R3 the courier hides the letter in a boot.'
const REPLY_4 = 'E2E-REGEN-R4 the letter names a city that no longer exists.'
const REPLY_5 = 'E2E-REGEN-R5 the city returns to the maps overnight.'
const EDITED_ACTION = 'E2E-REGEN-U3 I open the satchel and read the letter aloud.'
const FAILED_ACTION = 'E2E-REGEN-U5 I tear the letter in half.'

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

  function branchId(): Promise<string> {
    return currentBranchId(app.window, 'story_hero')
  }

  const entryIdByContent = (branch: string, marker: string) => entryIdOf(app.window, branch, marker)
  const pollEntryId = (branch: string, marker: string) => pollEntryIdOf(app.window, branch, marker)

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

  async function systemCount(branch: string): Promise<number> {
    const rows = await queryApp(
      app.window,
      `SELECT count(*) FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
      [branch],
    )
    return Number(rows[0][0])
  }

  // The failed turn's text as its failure entry stores it (wrapped, as the Send took it).
  async function failureSubmission(branch: string): Promise<string | undefined> {
    const rows = await queryApp(
      app.window,
      `SELECT json_extract(metadata, '$.systemFailure.submission.content') FROM story_entries
         WHERE branch_id = ? AND kind = 'system'`,
      [branch],
    )
    expect(rows.length, 'system entry count').toBeLessThanOrEqual(1)
    return (rows[0]?.[0] as string | null | undefined) ?? undefined
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

  // reader-composer.md → Custody of the turn's text: the failure entry holds the only copy, so
  // regenerating the reply beneath it, which deletes the entry, must hand the text back.
  test("regenerating under a failed turn's entry hands its text to the composer", async () => {
    const branch = await branchId()
    const replyId = await pollEntryId(branch, 'E2E-REGEN-R4')

    mock.failNextNarrative()
    await reader.composer(app.window).fill(FAILED_ACTION)
    await reader.send(app.window).click()
    await expect(reader.retrySystemEntry(app.window)).toBeVisible({ timeout: 30_000 })

    await expect
      .poll(() => failureSubmission(branch), { timeout: 15_000 })
      .toContain('E2E-REGEN-U5')
    const submission = await failureSubmission(branch)
    if (submission === undefined)
      throw new Error('failure entry: present at the poll, gone on read')
    // The entry is the only copy: no user_action row holds it, and the Send emptied the composer,
    // so the text the composer holds at the end can only have come back from the entry.
    expect(await entryIdByContent(branch, 'E2E-REGEN-U5')).toBeUndefined()
    await expect(reader.composer(app.window)).toHaveValue('')

    mock.setNarrative(REPLY_5)
    await reader.regenEntry(app.window, replyId).click()
    await pollEntryId(branch, 'E2E-REGEN-R5')

    await expect.poll(() => systemCount(branch), { timeout: 15_000 }).toBe(0)
    await expect(reader.composer(app.window)).toHaveValue(submission, { timeout: 15_000 })
  })
})
