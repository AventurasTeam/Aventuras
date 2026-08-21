import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import {
  createSeededUserDataDir,
  markEntitiesEmbeddingStale,
  removeUserDataDir,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'
const COPY_MODEL_ID = 'e2e/minilm-copy'

const STALE_TOTAL_SQL = `SELECT (SELECT count(*) FROM entities WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM lore WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM chapters WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM threads WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM happenings WHERE branch_id = ? AND embedding_stale = 1)`

// Every vec0 family, not just the ones the drain populates: the swap engine and
// relabel both sweep all five, so a family they missed has to show up here.
const VEC_ROWS_FOR_MODEL_SQL = `SELECT (SELECT count(*) FROM entities_vec_384 WHERE model_id = ?)
                                     + (SELECT count(*) FROM lore_vec_384 WHERE model_id = ?)
                                     + (SELECT count(*) FROM chapter_summaries_vec_384 WHERE model_id = ?)
                                     + (SELECT count(*) FROM threads_vec_384 WHERE model_id = ?)
                                     + (SELECT count(*) FROM happenings_vec_384 WHERE model_id = ?)`

// Drops one family's vectors without touching embedding_stale: the drain selects on
// the flag, so only a re-index — which ignores the flag — can refill the hole.
async function dropEntityVectors(app: LaunchedApp, modelId: string): Promise<void> {
  await queryApp(app.window, `DELETE FROM entities_vec_384 WHERE model_id = ?`, [modelId])
}

// Rewrites a row's embedded text behind the flag's back, so a re-index that skipped
// rows already holding a vector for this model would leave the old source_hash.
async function driftOneLoreRow(app: LaunchedApp): Promise<{ id: string; hash: string }> {
  const [[id]] = await queryApp(
    app.window,
    `SELECT id FROM lore WHERE branch_id = ? ORDER BY id LIMIT 1`,
    [HERO_BRANCH],
  )
  const [[hash]] = await queryApp(app.window, `SELECT source_hash FROM lore_vec_384 WHERE id = ?`, [
    id,
  ])
  await queryApp(app.window, `UPDATE lore SET body = ? WHERE branch_id = ? AND id = ?`, [
    'Rewritten behind the staleness flag, which stays clean on purpose.',
    HERO_BRANCH,
    id,
  ])
  return { id: String(id), hash: String(hash) }
}

async function loreHashOf(app: LaunchedApp, id: string): Promise<string> {
  const [[hash]] = await queryApp(app.window, `SELECT source_hash FROM lore_vec_384 WHERE id = ?`, [
    id,
  ])
  return String(hash)
}

async function staleTotal(app: LaunchedApp): Promise<number> {
  const [[n]] = await queryApp(app.window, STALE_TOTAL_SQL, Array<string>(5).fill(HERO_BRANCH))
  return Number(n)
}

async function vecRowsFor(app: LaunchedApp, modelId: string): Promise<number> {
  const [[n]] = await queryApp(app.window, VEC_ROWS_FOR_MODEL_SQL, Array<string>(5).fill(modelId))
  return Number(n)
}

async function readStorySettings(app: LaunchedApp): Promise<Record<string, unknown>> {
  const [[settingsJson]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
    HERO_STORY,
  ])
  return JSON.parse(settingsJson as string) as Record<string, unknown>
}

// Drives the embedder swap machinery through the Story Settings → Memory UI and
// asserts end-states through the DB (docs/testing.md → Selector strategy). The
// panel's marker-driven UI only refreshes at swap boundaries, so nothing here
// asserts on mid-swap chrome.
//
// Re-index and relabel share one test body because they're strictly ordered:
// re-index has to run while the story is still on the catalog model, since
// `resolveEmbedderConfig` resolves a local-backend target's dim from the catalog
// and the second installed model is a synthetic-id copy. Relabel is the one
// swap-engine path that never resolves a config — it rewrites vec0 identity in
// place — so it's what the copy can drive. Splitting them would leave the second
// assuming the first's navigation and DB state, which a retry (a fresh app at
// Home, replaying only the failed test) would not reproduce.
test.describe('embedder — story settings swap flow', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let originalModelId: string
  let dim: number

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB once; the second install reuses that cache.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    ;({ modelId: originalModelId, dim } = await installEmbedderModel(userDataDir))
    await installEmbedderModel(userDataDir, { idOverride: COPY_MODEL_ID })
    markEntitiesEmbeddingStale(seeded.dbPath, HERO_BRANCH)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('re-indexes on the current model, then switches models via relabel', async () => {
    // A drain settle, a full re-index and a relabel in one body; their own waits
    // sum past the default budget, and a bare test timeout would cut off the
    // polls below before they can report which condition failed.
    test.setTimeout(240_000)
    // Guards the vec0 table names in VEC_ROWS_FOR_MODEL_SQL against a catalog
    // dim change.
    expect(dim).toBe(384)

    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    // Let the story-open drain settle first: the drain controller skips a story
    // with a swap marker, so a swap kicked mid-drain races it and makes the
    // row counts below non-deterministic.
    await expect.poll(async () => staleTotal(app), { timeout: 60_000 }).toBe(0)
    const drained = await vecRowsFor(app, originalModelId)
    expect(drained).toBeGreaterThan(0)

    await storySettings.openFromReader(app.window).click()
    await storySettings.memoryTab(app.window).click()
    await expect(storySettings.memoryPanel(app.window)).toBeVisible()

    // Punch a hole the drain is structurally blind to, so only the re-index can refill
    // it. Counting growth would prove nothing: the drain has already embedded every row.
    await dropEntityVectors(app, originalModelId)
    const holed = await vecRowsFor(app, originalModelId)
    expect(holed, 'the drop should remove vectors the re-index must restore').toBeLessThan(drained)
    const drifted = await driftOneLoreRow(app)
    expect(await staleTotal(app), 'neither edit may flip a flag').toBe(0)

    await storySettings.reindexNow(app.window).click()
    await storySettings.reindexConfirmStart(app.window).click()

    // Polled as a shape rather than a boolean so a timeout names the condition
    // that never held and prints its actual, instead of a bare `false`.
    await expect
      .poll(
        async () => {
          const settings = await readStorySettings(app)
          const rows = await vecRowsFor(app, originalModelId)
          return {
            swapPending: 'embedding_swap_target' in settings,
            stale: await staleTotal(app),
            vecRows: rows === drained ? 'refilled' : `stuck at ${rows} (want ${drained})`,
            driftedRow:
              (await loreHashOf(app, drifted.id)) === drifted.hash
                ? 'not re-embedded'
                : 'rewritten',
          }
        },
        {
          message:
            'reindex-now should clear the swap marker, leave nothing stale and re-embed rows the drain skips',
          timeout: 90_000,
        },
      )
      .toEqual({
        swapPending: false,
        stale: 0,
        vecRows: 'refilled',
        driftedRow: 'rewritten',
      })

    const reindexed = await readStorySettings(app)
    expect(reindexed.embedding_model_id).toBe(originalModelId)
    expect(await vecRowsFor(app, COPY_MODEL_ID)).toBe(0)

    // --- relabel onto the second installed model, from the same open panel ---

    const before = await vecRowsFor(app, originalModelId)
    // The button disables itself off a store the re-index refreshes at its own
    // boundaries, so its enabled state can lag the DB-gated poll above. Without
    // this, a click on the still-disabled button would hang to the test timeout.
    await expect(storySettings.switchEmbedder(app.window)).toBeEnabled()
    await storySettings.switchEmbedder(app.window).click()
    await storySettings
      .swapCandidate(app.window, { modelId: COPY_MODEL_ID, backend: 'local' })
      .click()
    await storySettings.swapNext(app.window).click()
    await storySettings.swapRelabel(app.window).click()

    await expect
      .poll(
        async () => {
          const settings = await readStorySettings(app)
          return {
            modelId: settings.embedding_model_id,
            swapPending: 'embedding_swap_target' in settings,
          }
        },
        {
          message: 'relabel should record the new model id without staging a swap',
          timeout: 30_000,
        },
      )
      .toEqual({ modelId: COPY_MODEL_ID, swapPending: false })

    // Relabel rewrites identity rather than re-embedding, so every row moves and
    // the total is preserved exactly.
    expect(await vecRowsFor(app, originalModelId)).toBe(0)
    expect(await vecRowsFor(app, COPY_MODEL_ID)).toBe(before)
  })
})
