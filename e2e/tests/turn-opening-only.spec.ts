import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  OPENING_ONLY_BRANCH_ID,
  OPENING_ONLY_TITLE,
  removeUserDataDir,
  seedOpeningOnlyStory,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// testing.md → Coverage names "a turn on an opening-only branch" as a seam edge
// case: the scene tail the turn inherits metadata from IS the opening, the
// suggestion anchor has exactly one candidate, and the new action must seat at
// position 2 directly behind it. Everything else about the turn is turn.spec.ts.
const REPLY = 'E2E-OPENING-REPLY — the first letter arrives with the tide.'

test.describe('reader turn on an opening-only branch', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    seedOpeningOnlyStory(seeded.dbPath)
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

  test('the first user action seats directly behind the opening and the reply commits after it', async () => {
    const page = app.window
    await home.openStory(page, OPENING_ONLY_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })

    await reader.composer(page).fill('E2E-OPENING-ACTION I open the first letter.')
    await reader.send(page).click()

    await expect(page.getByText('E2E-OPENING-REPLY', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    const rows = await queryApp(
      page,
      `SELECT position, kind FROM story_entries WHERE branch_id = ? ORDER BY position`,
      [OPENING_ONLY_BRANCH_ID],
    )
    expect(rows).toEqual([
      [1, 'opening'],
      [2, 'user_action'],
      [3, 'ai_reply'],
    ])
  })
})
