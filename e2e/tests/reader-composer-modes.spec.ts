import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Composer modes (alternative flow): the hero story is adventure + has
// composerModesEnabled, so the mode dropdown is live. "Say" wraps the raw input
// into dialogue before submit (lib/composer-wrap), and the wrapped text is what
// gets committed as the user_action. Deterministic (no conjugation), so the
// committed content is exactly the wrapped shape. See docs/testing.md → Coverage.
const MARKER = 'E2E-MODES the tide is turning'

test.describe('reader — composer modes', () => {
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
    mock.setNarrative('E2E-MODES-REPLY the courier answers.')
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('applies the selected mode wrap to the committed user action', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    // Switch Free → Say (dialogue wrapper).
    await reader.modeTrigger(app.window).click()
    await reader.modeOption(app.window, 'say').click()

    await reader.composer(app.window).fill(MARKER)
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-MODES', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    const rows = await queryApp(
      app.window,
      `SELECT content FROM story_entries WHERE branch_id = ? AND kind = 'user_action' AND content LIKE '%E2E-MODES%'`,
      [branchId],
    )
    expect(rows.length, 'the wrapped user action committed').toBe(1)
    const content = (rows[0] as [string])[0]
    // "Say" wrap is: `"<text>" <lead> said.` — quoted, ending in `said.`, and no
    // longer equal to the raw input.
    expect(content).not.toBe(MARKER)
    expect(content.startsWith('"')).toBe(true)
    expect(content.trimEnd().endsWith('said.')).toBe(true)
  })
})
