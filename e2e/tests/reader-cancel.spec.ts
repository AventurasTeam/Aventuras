import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Cancel mid-turn (edge case): the mock holds the narrative stream open so the
// turn is provably in-flight, then Cancel aborts it. Cancel reverses the whole
// turn — the user action included (C6) — and hands the raw text back to the
// composer for re-send. The hold makes this deterministic (no sleep/timing
// race). See docs/testing.md → Coverage + Mock LLM.
const RAW = 'E2E-CANCEL-USER I hesitate at the threshold.'

test.describe('reader — cancel a turn mid-flight', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so without an installed embedder the
    // turn dies there and no stream is ever opened to cancel. Cold cache
    // downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('cancel reverses the whole turn and restores the draft', async () => {
    mock.holdNextNarrative()

    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill(RAW)
    await reader.send(app.window).click()

    // The held stream keeps the turn in-flight, so the composer shows Cancel.
    await expect(reader.cancel(app.window)).toBeVisible({ timeout: 20_000 })
    // Cancel is live from the first phase, and retrieval runs ahead of
    // narrative — so waiting on the button alone would let the click land
    // mid-retrieval, aborting a turn that never opened a stream and quietly
    // retiring what this spec exists to cover. The mock recording the streaming
    // request is the proof the held stream is actually open.
    await expect.poll(() => mock.requests.some((r) => r.streamed), { timeout: 20_000 }).toBe(true)
    await reader.cancel(app.window).click()

    // Generation ends: the composer returns to its Send state.
    await expect(reader.send(app.window)).toBeVisible({ timeout: 20_000 })

    // Nothing committed for this turn (user action reversed with it, C6).
    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    await expect
      .poll(
        async () =>
          (
            (
              await queryApp(
                app.window,
                `SELECT count(*) FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-CANCEL%'`,
                [branchId],
              )
            )[0] as [number]
          )[0],
        { timeout: 15_000 },
      )
      .toBe(0)

    // The raw draft is handed back for edit/re-send.
    await expect(reader.composer(app.window)).toHaveValue(/E2E-CANCEL-USER/)
  })
})
