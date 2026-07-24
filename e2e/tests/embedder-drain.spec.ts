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

const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'

// Scoped to the branch the drain warms: the worker only covers the open branch,
// so an unscoped count would also wait on rows nothing in this spec drains.
const STALE_TOTAL_SQL = `SELECT (SELECT count(*) FROM entities WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM lore WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM chapters WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM threads WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM happenings WHERE branch_id = ? AND embedding_stale = 1)`

async function staleTotal(app: LaunchedApp): Promise<number> {
  const [[n]] = await queryApp(app.window, STALE_TOTAL_SQL, Array<string>(5).fill(HERO_BRANCH))
  return Number(n)
}

// Opening a story kicks a background drain of its stale embedded rows
// (lib/embedder/drain.ts) — a real transformers.js embed pass over the seeded
// content populates the vec0 tables the seed leaves empty. See docs/testing.md
// → Embedder in E2E.
test.describe('embedder — drain on story open', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let dim: number

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    ;({ dim } = await installEmbedderModel(userDataDir))
    // The seed leaves every entity fresh, so entities_vec_* would stay empty.
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

    const [[entityVecRows]] = await queryApp(app.window, `SELECT count(*) FROM entities_vec_384`)
    expect(Number(entityVecRows)).toBeGreaterThan(0)

    const [[loreVecRows]] = await queryApp(app.window, `SELECT count(*) FROM lore_vec_384`)
    expect(Number(loreVecRows)).toBeGreaterThan(0)

    // Assert only the post-drain state — the pill's pre-drain visibility
    // depends on how much of the drain has already run by the time the composer
    // paints, which isn't a stable window to assert against. The describe below
    // is this assertion's positive control.
    await expect(reader.embedderOfflinePill(app.window)).toBeHidden()
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

    await expect(reader.embedderOfflinePill(app.window)).toBeVisible({ timeout: 20_000 })
    expect(await staleTotal(app)).toBeGreaterThan(0)
  })
})
