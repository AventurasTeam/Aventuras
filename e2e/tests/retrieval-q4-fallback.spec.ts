import { expect, test } from '@playwright/test'

import { currentBranchId, latestCapture, queryApp, tailMetadata } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  enableDiagnostics,
  enableStoryProbeMode,
  removeUserDataDir,
  setPiggybackMode,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Q4 on the FALLBACK path (docs/memory/retrieval.md#q4-classifier-emitted-queries), the one a
// default-configured story runs: piggybackMode defaults to 'off', so the asks come from the
// fallback classifier's own structured call. retrieval-q4.spec.ts covers the fold instead.

const HERO_TITLE = 'The Veilstone Courier'
const HERO_STORY_ID = 'story_hero'

const ASK_A = 'E2E-Q4F-ASK House Eldrin sigil provenance'
const ASK_B = 'E2E-Q4F-ASK marsh territory exile customs'
const ASK_C = 'E2E-Q4F-ASK ferry schedules along the reed channels'
const ASK_D = 'E2E-Q4F-ASK who last carried the courier seal'

// No <state> block anywhere in the prose: with the fold off nothing else can write these
// fields, so a value in metadata came from the fallback's structured call or from nowhere.
const narrative = (marker: string) => `${marker} The storm bends the reeds flat.`

// The seeded story has suggestion categories enabled and the fold is off, so the phase takes
// the `-suggestions` branch. Both are set anyway: which fires is fixture settings, not Q4.
function setAsks(mock: MockLlm, askOne: string, askTwo: string): void {
  const reply = {
    sceneEntities: [],
    worldTimeDelta: 0,
    summary: 'The courier crossed the marsh under storm light.',
    retrievalQueries: [askOne, askTwo],
  }
  mock.setStructured('per-turn-classifier', reply)
  mock.setStructured('per-turn-classifier-suggestions', { ...reply, suggestions: [] })
}

test.describe('retrieval Q4 — fallback classifier across a turn boundary', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Embed failure blocks the reply (model-management.md → Embed failure is blocking); cold
    // cache pulls ~24 MB from Hugging Face before launch, hence the long timeout.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(narrative('E2E-Q4F-TURN'))
    setAsks(mock, ASK_A, ASK_B)
    setProviderEndpoint(seeded.dbPath, mock.url)
    // The whole point of this spec: the fixture seeds 'on', a real story defaults to 'off'.
    setPiggybackMode(seeded.dbPath, HERO_STORY_ID, 'off')
    // Both probe gates: app half (diagnostics) and story half (probe_mode_active).
    enableDiagnostics(seeded.dbPath)
    enableStoryProbeMode(seeded.dbPath, HERO_STORY_ID)
    app = await launchApp({ userDataDir, cleanupUserData: true })
    // Tripwire: proves the seed landed, not that the app read it. Without it, deleting the
    // call above still reads layer === 'per_turn_classifier' — a failed fold ends there too.
    const [[raw]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
      HERO_STORY_ID,
    ])
    expect((JSON.parse(raw as string) as { piggybackMode: string }).piggybackMode).toBe('off')
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('the fallback classifier emits Q4 and the next turn embeds it', async () => {
    test.setTimeout(120_000)

    let branchId = ''

    await test.step('turn 1 — the fallback writes the asks', async () => {
      await home.openStory(app.window, HERO_TITLE).click()
      await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
      await reader.composer(app.window).fill('E2E-Q4F-USER-1 I press toward the ridge.')
      await reader.send(app.window).click()
      await expect(app.window.getByText('E2E-Q4F-TURN', { exact: false })).toBeVisible({
        timeout: 30_000,
      })

      branchId = await currentBranchId(app.window, HERO_STORY_ID)

      await expect
        .poll(async () => (await tailMetadata(app.window, branchId))?.retrievalQueries, {
          timeout: 30_000,
        })
        .toEqual([ASK_A, ASK_B])

      // Provenance: only this phase writes 'per_turn_classifier'. It does NOT prove the fold
      // was off — a fold that fired and failed lands here too; the beforeAll tripwire covers that.
      expect((await tailMetadata(app.window, branchId))?.stateReport?.layer).toBe(
        'per_turn_classifier',
      )

      // The five-slot poll in step 2 only distinguishes turn 2's capture from turn 1's
      // because turn 1 had no prior row to read: three fixed slots, no Q4.
      expect((await latestCapture(app.window, branchId))?.queries.length).toBe(3)
    })

    await test.step('turn 2 — retrieval embeds turn 1 asks, not its own', async () => {
      // Turn 2 emits different asks, so the capture below pins Q4 to the COMMITTED previous
      // row — not a stale store copy, a re-read, or a shifted readSceneSource anchor.
      setAsks(mock, ASK_C, ASK_D)
      mock.setNarrative(narrative('E2E-Q4F-TURN-2'))
      await reader.composer(app.window).fill('E2E-Q4F-USER-2 I ask what the sigil means.')
      await reader.send(app.window).click()

      // Turn 1 wrote its own capture with three slots (Q1-Q3, no emitted Q4 yet), so
      // polling for five is what waits for turn 2's row specifically.
      await expect
        .poll(async () => (await latestCapture(app.window, branchId))?.queries.length, {
          timeout: 30_000,
        })
        .toBe(5)

      const capture = (await latestCapture(app.window, branchId))!
      expect(capture.queries.map((q) => q.source)).toEqual([
        'user_action',
        'structural_digest',
        'piggyback_summary',
        'classifier_emitted',
        'classifier_emitted',
      ])
      expect(capture.queries.slice(3).map((q) => q.text)).toEqual([ASK_A, ASK_B])

      // Without this, the line above passes even if the ASK_C/ASK_D override never reached the
      // model — the mock's override Map persists, so turn 2 would re-serve turn 1's asks.
      await expect
        .poll(async () => (await tailMetadata(app.window, branchId))?.retrievalQueries, {
          timeout: 30_000,
        })
        .toEqual([ASK_C, ASK_D])
    })
  })
})
