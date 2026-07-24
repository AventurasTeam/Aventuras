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
// The two tests share one app and run in order: re-index has to happen while the
// story is still on the catalog model, because `resolveEmbedderConfig` resolves a
// local-backend target's dim from the catalog and the second installed model is a
// synthetic-id copy. Relabel is the one swap-engine path that never resolves a
// config — it rewrites vec0 identity in place — so it's what the copy can drive.
test.describe('embedder — story settings swap flow', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let originalModelId: string

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB once; the second install reuses that cache.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    ;({ modelId: originalModelId } = await installEmbedderModel(userDataDir))
    await installEmbedderModel(userDataDir, { idOverride: COPY_MODEL_ID })
    markEntitiesEmbeddingStale(seeded.dbPath, HERO_BRANCH)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('re-indexes the story on its current model through the staging engine', async () => {
    test.setTimeout(180_000)

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

    await storySettings.reindexNow(app.window).click()

    // The drain only embeds stale rows on the open branch; re-index re-embeds
    // every row of every branch, so a completed run strictly grows the vec set.
    // Pairing that with the cleared marker rules out sampling before the marker
    // was ever written — rows can only grow after it is.
    await expect
      .poll(
        async () => {
          const settings = await readStorySettings(app)
          if ('embedding_swap_target' in settings) return false
          if ((await staleTotal(app)) !== 0) return false
          return (await vecRowsFor(app, originalModelId)) > drained
        },
        { timeout: 90_000 },
      )
      .toBe(true)

    const settings = await readStorySettings(app)
    expect(settings.embedding_model_id).toBe(originalModelId)
    expect(await vecRowsFor(app, COPY_MODEL_ID)).toBe(0)
  })

  test('switches the story to another installed model via relabel', async () => {
    // Continues from the previous test: the Memory panel is open and the story
    // is re-indexed on its original model.
    const before = await vecRowsFor(app, originalModelId)
    expect(before).toBeGreaterThan(0)

    await storySettings.switchEmbedder(app.window).click()
    await storySettings.swapCandidate(app.window, COPY_MODEL_ID).click()
    await storySettings.swapNext(app.window).click()
    await storySettings.swapRelabel(app.window).click()

    await expect
      .poll(
        async () => {
          const settings = await readStorySettings(app)
          return (
            settings.embedding_model_id === COPY_MODEL_ID && !('embedding_swap_target' in settings)
          )
        },
        { timeout: 30_000 },
      )
      .toBe(true)

    // Relabel rewrites identity rather than re-embedding, so every row moves and
    // the total is preserved exactly.
    expect(await vecRowsFor(app, originalModelId)).toBe(0)
    expect(await vecRowsFor(app, COPY_MODEL_ID)).toBe(before)
  })
})
