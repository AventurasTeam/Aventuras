import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
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
