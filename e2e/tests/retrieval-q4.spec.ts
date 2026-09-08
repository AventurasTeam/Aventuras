import { expect, test, type Page } from '@playwright/test'

import { currentBranchId, latestCapture, queryApp, tailMetadata } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  enableDiagnostics,
  enableStoryProbeMode,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Q4 end-to-end (docs/memory/retrieval.md#q4-classifier-emitted-queries) — the only seam a
// running app reaches: turn 1 writes metadata.retrievalQueries, turn 2 reads it back as
// direct-slot queries.

const HERO_TITLE = 'The Veilstone Courier'
const HERO_STORY_ID = 'story_hero'

const ASK_A = 'E2E-Q4-ASK House Eldrin sigil provenance'
const ASK_B = 'E2E-Q4-ASK marsh territory exile customs'
const ASK_C = 'E2E-Q4-ASK ferry schedules along the reed channels'
const ASK_D = 'E2E-Q4-ASK who last carried the courier seal'

const narrative = (
  marker: string,
  askOne: string,
  askTwo: string,
) => `${marker} The storm bends the reeds flat.
<state>
  <scene_entities></scene_entities>
  <world_time_delta>0</world_time_delta>
  <summary>The courier crossed the marsh under storm light.</summary>
  <retrieval_queries>
    <query>${askOne}</query>
    <query>${askTwo}</query>
  </retrieval_queries>
</state>`

async function tailEntryId(page: Page, branchId: string): Promise<string> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'
     ORDER BY position DESC LIMIT 1`,
    [branchId],
  )
  return rows[0]?.[0] as string
}

test.describe('retrieval Q4 — classifier-emitted queries across a turn boundary', () => {
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
    mock.setNarrative(narrative('E2E-Q4-TURN', ASK_A, ASK_B))
    setProviderEndpoint(seeded.dbPath, mock.url)
    // Both probe gates: app half (diagnostics) and story half (probe_mode_active).
    enableDiagnostics(seeded.dbPath)
    enableStoryProbeMode(seeded.dbPath, HERO_STORY_ID)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('turn 1 emits queries into metadata; turn 2 embeds them as direct-slot queries', async () => {
    test.setTimeout(120_000)

    let branchId = ''

    await test.step('turn 1 persists the emitted asks and renders them', async () => {
      await home.openStory(app.window, HERO_TITLE).click()
      await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
      await reader.composer(app.window).fill('E2E-Q4-USER-1 I press toward the ridge.')
      await reader.send(app.window).click()
      await expect(app.window.getByText('E2E-Q4-TURN', { exact: false })).toBeVisible({
        timeout: 30_000,
      })

      branchId = await currentBranchId(app.window, HERO_STORY_ID)

      await expect
        .poll(async () => (await tailMetadata(app.window, branchId))?.retrievalQueries, {
          timeout: 30_000,
        })
        .toEqual([ASK_A, ASK_B])

      // Only unit/Storybook-unreachable coverage of the reader-surface.tsx pass-through:
      // the panel is otherwise pinned by entry-card's own stories.
      const entryId = await tailEntryId(app.window, branchId)
      await reader.showState(app.window, entryId).click()
      await expect(reader.row(app.window, entryId).getByText(ASK_A)).toBeVisible()
      await expect(reader.row(app.window, entryId).getByText(ASK_B)).toBeVisible()

      // The five-slot poll in step 2 only distinguishes turn 2's capture from turn 1's
      // because turn 1 had no prior row to read: three fixed slots, no Q4.
      expect((await latestCapture(app.window, branchId))?.queries.length).toBe(3)
    })

    await test.step('turn 2 embeds them as direct-slot queries and captures redundancy', async () => {
      // Turn 2 emits different asks (ASK_C/ASK_D), so the capture below pins Q4 to the COMMITTED
      // previous row — not a stale store copy, a re-read, or a shifted readSceneSource anchor.
      mock.setNarrative(narrative('E2E-Q4-TURN-2', ASK_C, ASK_D))
      await reader.composer(app.window).fill('E2E-Q4-USER-2 I ask what the sigil means.')
      await reader.send(app.window).click()

      // Turn 1 wrote its own capture with three slots (Q1-Q3, no emitted Q4 yet), so
      // polling for five is what waits for turn 2's row specifically.
      await expect
        .poll(async () => (await latestCapture(app.window, branchId))?.queries.length, {
          timeout: 30_000,
        })
        .toBe(5)

      const capture = (await latestCapture(app.window, branchId))!
      // Hardcoded, not imported from CAPTURE_VERSION: a version bump must touch this line, so
      // a failure here points at the migration, not a mystery E2E regression.
      expect(capture.capture_version).toBe(7)
      expect(capture.queries.map((q) => q.source)).toEqual([
        'user_action',
        'structural_digest',
        'piggyback_summary',
        'classifier_emitted',
        'classifier_emitted',
      ])
      expect(capture.queries.slice(3).map((q) => q.text)).toEqual([ASK_A, ASK_B])
      expect(capture.queries.slice(0, 3).map((q) => q.redundancy)).toEqual([null, null, null])
      for (const q of capture.queries.slice(3)) {
        // redundancy = matched / topK.length is closed on [0, 1] by construction; the
        // informative check is that it was computed at all (not null).
        expect(typeof q.redundancy).toBe('number')
        // Cut is REDUNDANCY_K = 10 nearest rows globally, not the full KNN pass — a regression
        // to the old unpinned denominator would blow past this (retrieval.md → Redundancy).
        expect(q.redundancy_k).toBeGreaterThan(0)
        expect(q.redundancy_k).toBeLessThanOrEqual(10)
      }
      // Positionally aligned with the queries, which is what blendSims indexes on.
      expect(capture.pools.entities[0]?.sims).toHaveLength(5)
    })
  })
})
