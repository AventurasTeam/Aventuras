import { expect, test } from '@playwright/test'

import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  disablePiggybackCapability,
  removeUserDataDir,
  setProfileStructuredOutput,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'

// Pins what force-on actually puts on the wire for an openai-compatible
// provider: it engages native JSON mode (response_format) and skips the
// prompt-injected schema block — but the SDK sends only `{type:'json_object'}`,
// i.e. no schema travels with it. That's the concrete reason every other E2E
// leans on the prompt-embedded schema (the auto path). If the SDK/provider ever
// starts emitting json_schema, this test flags the change. See
// docs/testing.md → Mock LLM.
test.describe('force-on structured output', () => {
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
    mock.setNarrative('E2E-FORCEON-REPLY the courier waits.')
    setProviderEndpoint(seeded.dbPath, mock.url)
    disablePiggybackCapability(seeded.dbPath) // force the structured classifier call
    setProfileStructuredOutput(seeded.dbPath, 'prof_classifier', 'force-on')
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('engages native response_format and skips the prompt-injected schema', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    const composer = app.window.getByPlaceholder(t('reader:composerPlaceholder'))
    await expect(composer).toBeVisible({ timeout: 20_000 })
    await composer.fill('E2E-FORCEON-USER I wait.')
    await app.window.getByRole('button', { name: t('reader:send') }).click()

    // Distinct from the user action text ("E2E-FORCEON-USER …") so the match
    // is unambiguous under strict mode.
    await expect(app.window.getByText('E2E-FORCEON-REPLY', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    await expect.poll(() => mock.requests.some((r) => !r.streamed), { timeout: 15_000 }).toBe(true)
    const structured = mock.requests.find((r) => !r.streamed)!

    // force-on engaged native JSON mode on the request…
    expect(structured.body.response_format).toEqual({ type: 'json_object' })
    // …and did NOT prompt-inject the schema (so the block-matcher finds nothing).
    expect(structured.agent).toBeNull()
  })
})
