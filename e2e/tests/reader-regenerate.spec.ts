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
// The two tests below share one running app and DB, the second building on
// the first's committed state (playwright.config.ts pins workers:1 and
// fullyParallel:false, and this file makes no test.describe.configure(), so
// Playwright's default in-file declaration order keeps them serial).
const REPLY_1 = 'E2E-REGEN-R1 the courier reads the letter twice.'
const REPLY_2 = 'E2E-REGEN-R2 the courier burns the letter unread.'
const REPLY_3 = 'E2E-REGEN-R3 the courier hides the letter in a boot.'

test.describe('reader — regenerate a reply', () => {
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

  async function entryIdByContent(branch: string, marker: string): Promise<string | undefined> {
    const rows = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE ?`,
      [branch, `%${marker}%`],
    )
    return rows[0]?.[0] as string | undefined
  }

  async function createActionId(branch: string, entryId: string): Promise<string> {
    return (
      await queryApp(
        app.window,
        `SELECT action_id FROM deltas WHERE branch_id = ? AND target_table = 'story_entries'
           AND op = 'create' AND target_id = ?`,
        [branch, entryId],
      )
    )[0][0] as string
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
    const oldReplyId = await entryIdByContent(branch, 'E2E-REGEN-R1')
    const userActionId = await entryIdByContent(branch, 'E2E-REGEN-U1')
    // Proves both rows landed before regenerate acts on them — otherwise the
    // "gone" / "untouched" assertions below would be vacuous.
    expect(oldReplyId).toBeDefined()
    expect(userActionId).toBeDefined()
    const userActionActionId = await createActionId(branch, userActionId!)

    mock.setNarrative(REPLY_2)
    await reader.regenEntry(app.window, oldReplyId!).click()
    await expect(app.window.getByText('E2E-REGEN-R2', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    // Old take gone; the originating user action untouched (same row id).
    expect(await entryIdByContent(branch, 'E2E-REGEN-R1')).toBeUndefined()
    expect(await entryIdByContent(branch, 'E2E-REGEN-U1')).toBe(userActionId)

    // The new take rides a fresh turn action_id, not the original group's.
    const newReplyId = await entryIdByContent(branch, 'E2E-REGEN-R2')
    expect(newReplyId).toBeDefined()
    expect(await createActionId(branch, newReplyId!)).not.toBe(userActionActionId)
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

    // Proves the second turn actually committed before the cascade removes it —
    // otherwise the U2/R3-gone assertions below would be vacuous.
    const olderReplyId = await entryIdByContent(branch, 'E2E-REGEN-R2')
    const userAction2Id = await entryIdByContent(branch, 'E2E-REGEN-U2')
    const newerReplyId = await entryIdByContent(branch, 'E2E-REGEN-R3')
    expect(olderReplyId).toBeDefined()
    expect(userAction2Id).toBeDefined()
    expect(newerReplyId).toBeDefined()

    mock.setNarrative(REPLY_1)
    await reader.regenEntry(app.window, olderReplyId!).click()

    // Cascade path: the confirm modal gates the deeper reversal.
    await expect(reader.regenerateConfirm(app.window)).toBeVisible({ timeout: 10_000 })
    await reader.regenerateConfirm(app.window).click()
    await expect(app.window.getByText('E2E-REGEN-R1', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    // The cascade removed the old take AND the later turn; U1 survives.
    expect(await entryIdByContent(branch, 'E2E-REGEN-R2')).toBeUndefined()
    expect(await entryIdByContent(branch, 'E2E-REGEN-U2')).toBeUndefined()
    expect(await entryIdByContent(branch, 'E2E-REGEN-R3')).toBeUndefined()
    expect(await entryIdByContent(branch, 'E2E-REGEN-U1')).toBeDefined()
  })
})
