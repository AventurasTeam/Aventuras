import { expect, test } from '@playwright/test'

import { branchStaleTotal, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import {
  createSeededUserDataDir,
  markEntitiesEmbeddingStale,
  markSwapPending,
  removeUserDataDir,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'
const HERO_STORY = 'story_hero'

const staleTotal = (app: LaunchedApp): Promise<number> => branchStaleTotal(app.window, HERO_BRANCH)

// Opening a story kicks a background drain of its stale embedded rows
// (lib/embedder/drain.ts) — a real transformers.js embed pass over the seeded
// content populates the vec0 tables the seed leaves empty. See docs/testing.md
// → Embedder in E2E.
test.describe('embedder — drain on story open', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let dim: number
  let modelId: string

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    ;({ dim, modelId } = await installEmbedderModel(userDataDir))
    // Redundant now that the seed leaves every entity stale — kept so this spec
    // doesn't silently stop populating entities_vec_* if the seed goes clean again.
    markEntitiesEmbeddingStale(seeded.dbPath, HERO_BRANCH)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('drains stale rows and populates vec0 on story open', async () => {
    // A real embed pass over every stale row outruns the default test budget.
    test.setTimeout(150_000)
    // Guards the vec0 table names asserted below against a catalog dim change.
    expect(dim).toBe(384)

    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    await expect.poll(async () => staleTotal(app), { timeout: 60_000 }).toBe(0)

    // Scoped to branch AND model id: knnQuery filters on model_id, so vectors written
    // under the wrong one break retrieval while a bare `count(*) > 0` still passes.
    const vecRows = async (table: string): Promise<number> =>
      Number(
        (
          await queryApp(
            app.window,
            `SELECT count(*) FROM ${table} WHERE branch_id = ? AND model_id = ?`,
            [HERO_BRANCH, modelId],
          )
        )[0][0],
      )

    expect(await vecRows('entities_vec_384')).toBeGreaterThan(0)
    expect(await vecRows('lore_vec_384')).toBeGreaterThan(0)

    // Assert only the post-drain state — the pill's pre-drain visibility
    // depends on how much of the drain has already run by the time the composer
    // paints, which isn't a stable window to assert against. The describe below
    // is this assertion's positive control.
    //
    // Two writers feed the count behind the pill: the reader's mount-time
    // refresh, which counts the whole story, and the drain sink, which reports
    // only the open branch's remaining — and by the time this runs the sink
    // wrote last. They agree with the branch-scoped poll above only because
    // every embeddable seeded row lives on br_hero_main; one on the fork branch
    // would leave a story-wide count the drain never clears.
    await expect(reader.memoryIncompletePill(app.window)).toBeHidden()
  })
})

// Positive control for the absence assertion above: with no model installed the
// drain can never clear a row, so the pill is stably visible and a locator that
// silently matched nothing would fail here.
test.describe('embedder — offline status pill', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Deliberately no installEmbedderModel: every drain batch throws and backs off.
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('shows the pill while the seeded stale rows cannot be drained', async () => {
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    await expect(reader.memoryIncompletePill(app.window)).toBeVisible({ timeout: 20_000 })
    expect(await staleTotal(app)).toBeGreaterThan(0)
  })
})

// A swap interrupted mid-phase-1 leaves only the marker behind. Staging clears
// embedding_stale as it goes, so the count-driven pill cannot be relied on to
// raise this state — the marker is the signal, and it outranks the count.
test.describe('embedder — swap-paused status pill', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    markSwapPending(seeded.dbPath, HERO_STORY, 'onnx-community/embeddinggemma-300m-ONNX')
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('surfaces the paused swap ahead of the seeded stale rows', async () => {
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    // Opening the story prompts first; the pill is what carries the state once the
    // user defers that decision, and is then the only signal left.
    await expect(storySettings.resumePrompt(app.window)).toBeVisible({ timeout: 20_000 })
    await storySettings.resumeLater(app.window).click()

    await expect(reader.swapPausedPill(app.window)).toBeVisible({ timeout: 20_000 })
    // The seed leaves rows stale, so both conditions hold — a wedged swap is the
    // one the user has to act on, and it must not be masked by the count.
    expect(await staleTotal(app)).toBeGreaterThan(0)
    await expect(reader.memoryIncompletePill(app.window)).toBeHidden()
  })
})
