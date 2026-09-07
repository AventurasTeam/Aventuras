import { expect, test, type Page } from '@playwright/test'
import { gunzipSync } from 'fflate'

import type { EntryMetadata, ProbeCapturePayload } from '@/lib/db'

import { queryApp } from '../harness/db'
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

// Q4 end-to-end (docs/memory/retrieval.md#q4-classifier-emitted-queries). The seam only a
// running app reaches is the two-turn one: turn 1's tagged block writes
// metadata.retrievalQueries, and turn 2's retrieval pass reads that row back as its
// direct-slot queries. Parsing, capping and blending have thorough unit coverage and are
// not re-driven here (docs/testing.md → Coverage).

const HERO_TITLE = 'The Veilstone Courier'
const HERO_STORY_ID = 'story_hero'

const ASK_A = 'E2E-Q4-ASK House Eldrin sigil provenance'
const ASK_B = 'E2E-Q4-ASK marsh territory exile customs'

const narrative = (marker: string) => `${marker} The storm bends the reeds flat.
<state>
  <scene_entities></scene_entities>
  <world_time_delta>0</world_time_delta>
  <summary>The courier crossed the marsh under storm light.</summary>
  <retrieval_queries>
    <query>${ASK_A}</query>
    <query>${ASK_B}</query>
  </retrieval_queries>
</state>`

async function currentBranchId(page: Page): Promise<string> {
  const rows = await queryApp(
    page,
    `SELECT current_branch_id FROM stories WHERE id = '${HERO_STORY_ID}'`,
  )
  return rows[0]?.[0] as string
}

// queryApp is a raw SQL bridge, not drizzle's typed select, so the column's
// `mode: 'json'` transform never runs — parse it here instead.
async function tailMetadata(page: Page, branchId: string): Promise<EntryMetadata | null> {
  const rows = await queryApp(
    page,
    `SELECT metadata FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'
     ORDER BY position DESC LIMIT 1`,
    [branchId],
  )
  const raw = rows[0]?.[0] as string | null | undefined
  return raw ? (JSON.parse(raw) as EntryMetadata) : null
}

async function tailEntryId(page: Page, branchId: string): Promise<string> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'
     ORDER BY position DESC LIMIT 1`,
    [branchId],
  )
  return rows[0]?.[0] as string
}

const LATEST_CAPTURE_SQL = `SELECT payload FROM probe_captures
   WHERE branch_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1`

// The payload is a gzipped blob; page.evaluate's bridge does not carry a Uint8Array
// back out of the page intact, so it is widened to a number array in-page and
// rebuilt + gunzipped here in Node.
async function latestCapture(page: Page, branchId: string): Promise<ProbeCapturePayload | null> {
  const bytes = await page.evaluate(
    async ({ sql, branchId }) => {
      const { rows } = await (
        window as unknown as {
          aventurasDb: {
            query: (s: string, p: unknown[], m: string) => Promise<{ rows: unknown[][] }>
          }
        }
      ).aventurasDb.query(sql, [branchId], 'all')
      const blob = rows[0]?.[0] as ArrayLike<number> | undefined
      return blob === undefined ? null : Array.from(blob)
    },
    { sql: LATEST_CAPTURE_SQL, branchId },
  )
  if (bytes === null) return null
  const json = new TextDecoder().decode(gunzipSync(Uint8Array.from(bytes)))
  return JSON.parse(json) as ProbeCapturePayload
}

test.describe('retrieval Q4 — classifier-emitted queries across a turn boundary', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed embedder
    // never reaches the reply (model-management.md → Embed failure is blocking).
    // Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(narrative('E2E-Q4-TURN'))
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

      branchId = await currentBranchId(app.window)

      await expect
        .poll(async () => (await tailMetadata(app.window, branchId))?.retrievalQueries, {
          timeout: 30_000,
        })
        .toEqual([ASK_A, ASK_B])

      // Only unit/Storybook-unreachable coverage of the reader-surface.tsx pass-through:
      // the panel is otherwise pinned by entry-card's own stories.
      const entryId = await tailEntryId(app.window, branchId)
      await reader.showState(app.window, entryId).click()
      await expect(app.window.getByText(ASK_A)).toBeVisible()
      await expect(app.window.getByText(ASK_B)).toBeVisible()
    })

    await test.step('turn 2 embeds them as direct-slot queries and captures redundancy', async () => {
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
      expect(capture.capture_version).toBe(7)
      expect(capture.queries.map((q) => q.source)).toEqual([
        'user_action',
        'structural_digest',
        'piggyback_summary',
        'classifier_emitted',
        'classifier_emitted',
      ])
      expect(capture.queries.slice(3).map((q) => q.text)).toEqual([ASK_A, ASK_B])
      expect(capture.queries.slice(0, 3).every((q) => q.redundancy === null)).toBe(true)
      for (const q of capture.queries.slice(3)) {
        expect(q.redundancy).toBeGreaterThanOrEqual(0)
        expect(q.redundancy).toBeLessThanOrEqual(1)
        // The cut is REDUNDANCY_K = 10 nearest rows globally, not the full KNN pass —
        // a regression to the old unpinned denominator would blow past this
        // (docs/memory/retrieval.md → Redundancy).
        expect(q.redundancy_k).toBeGreaterThan(0)
        expect(q.redundancy_k).toBeLessThanOrEqual(10)
      }
      // Positionally aligned with the queries, which is what blendSims indexes on.
      expect(capture.pools.entities[0]?.sims).toHaveLength(5)
    })
  })
})
