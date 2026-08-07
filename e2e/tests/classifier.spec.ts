import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  disablePiggybackCapability,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'

// With piggyback disabled, a single turn fans out into TWO calls on the one
// endpoint — the streaming narrative and the non-streaming fallback classifier
// — which is the mock's request-routing under real load. See docs/testing.md
// → Mock LLM.
test.describe('turn fanning out to the fallback classifier', () => {
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
    mock.setNarrative('E2E-CLASSIFIER-TURN the courier moves.')
    setProviderEndpoint(seeded.dbPath, mock.url)
    disablePiggybackCapability(seeded.dbPath)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('routes the narrative to the SSE stream and the classifier to the JSON path', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    const composer = app.window.getByPlaceholder(t('reader:composerPlaceholder'))
    await expect(composer).toBeVisible({ timeout: 20_000 })
    await composer.fill('E2E-CLASSIFIER-USER I wait in the rain.')
    await app.window.getByRole('button', { name: t('reader:send') }).click()

    await expect(app.window.getByText('E2E-CLASSIFIER-TURN', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    // One endpoint, two shapes: a streaming narrative and a structured call the
    // mock matched to the classifier by its injected schema block. The
    // classifier fires after the narrative, so poll for it. The seeded story
    // has suggestions enabled, so the actual reply shape is the
    // suggestions-carrying variant (per-turn-classifier-suggestions) — this
    // spec is about the fan-out, not the reply shape, so it accepts either.
    expect(mock.requests.some((r) => r.streamed)).toBe(true)
    await expect
      .poll(
        () => mock.requests.some((r) => !r.streamed && r.agent?.startsWith('per-turn-classifier')),
        { timeout: 15_000 },
      )
      .toBe(true)

    // The AI reply still commits despite the extra classifier round-trip.
    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    const reply = await queryApp(
      app.window,
      `SELECT kind FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-CLASSIFIER-TURN%'`,
      [branchId],
    )
    expect(reply.length, 'AI reply committed').toBe(1)
  })
})
