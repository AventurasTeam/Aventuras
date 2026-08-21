import { expect, test } from '@playwright/test'

import { branchStaleTotal, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  insertEmbeddableLoreRows,
  LORE_FILLER_ID_PREFIX,
  markEntitiesEmbeddingStale,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Only a running app puts main's between-chunk abort check (electron/embedder/
// service.ts) behind the real IPC hop and Chromium message pump; the unit tests
// drive it with a hand-built AbortController. See docs/testing.md → Coverage.
const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'
const RAW = 'E2E-EMBED-CANCEL I hesitate at the threshold.'

// 20 chunks at ~450 ms each on the default catalog model (measured): the cancel
// lands seconds inside a ~9 s run, and the drain restarting behind it needs that
// same ~9 s to embed every row — where the assertion reads within a second.
const FILLER_ROWS = 320

// A DB round trip costs this much only while main is blocked inside an ONNX run;
// idle ones are single-digit ms. Well under a chunk's ~450 ms, so it is not tuned
// to this machine's speed — a slower one only makes the sample larger.
const MAIN_BLOCKED_MS = 120

const countApp = async (app: LaunchedApp, sql: string, params: unknown[]): Promise<number> =>
  Number((await queryApp(app.window, sql, params))[0][0])

const staleEntities = (app: LaunchedApp): Promise<number> =>
  countApp(app, `SELECT count(*) FROM entities WHERE branch_id = ? AND embedding_stale = 1`, [
    HERO_BRANCH,
  ])

// GLOB, not LIKE: the prefix's own underscores are single-character wildcards to
// LIKE, so it would also count rows no filler wrote.
const fillerRows = (app: LaunchedApp, stale: 0 | 1): Promise<number> =>
  countApp(
    app,
    `SELECT count(*) FROM lore WHERE branch_id = ? AND id GLOB ? AND embedding_stale = ?`,
    [HERO_BRANCH, `${LORE_FILLER_ID_PREFIX}*`, stale],
  )

// The flag count alone cannot see a partial commit: a chunk loop that wrote
// vectors then failed to clear reads identically to one that wrote none.
const fillerVectors = (app: LaunchedApp): Promise<number> =>
  countApp(app, `SELECT count(*) FROM lore_vec_384 WHERE branch_id = ? AND id GLOB ?`, [
    HERO_BRANCH,
    `${LORE_FILLER_ID_PREFIX}*`,
  ])

test.describe('embedder — cancel a local embed mid-turn', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let dbPath: string

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    dbPath = seeded.dbPath
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('cancelling mid-retrieval leaves rows the turn was handed unembedded', async () => {
    // A real embed pass over the filler set outruns the default test budget in
    // the mutation case this spec exists to fail on.
    test.setTimeout(150_000)

    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    // Let the story-open drain finish first: it walks the same branch as the
    // turn's sync stage and would embed these rows out from under it. Nothing
    // re-kicks it after — an external DB write raises none of its triggers.
    await expect.poll(() => branchStaleTotal(app.window, HERO_BRANCH), { timeout: 60_000 }).toBe(0)

    const entityCount = await countApp(app, `SELECT count(*) FROM entities WHERE branch_id = ?`, [
      HERO_BRANCH,
    ])
    // Without entities to revalidate the starting gun below fires on an empty
    // set and would let the cancel land before the embed had begun.
    expect(entityCount).toBeGreaterThan(0)

    insertEmbeddableLoreRows(dbPath, HERO_BRANCH, FILLER_ROWS)
    // Their vectors survive the flag, so the sync stage revalidates rather than
    // re-embeds — its clearing commit is the last thing before the embed call.
    markEntitiesEmbeddingStale(dbPath, HERO_BRANCH)

    // Both writes came from a second connection to the fixture file; these read
    // back through the app's own, which is what makes a post-launch write sound.
    expect(await fillerRows(app, 1)).toBe(FILLER_ROWS)
    expect(await staleEntities(app)).toBe(entityCount)

    await reader.composer(app.window).fill(RAW)
    await reader.send(app.window).click()
    await expect(reader.cancel(app.window)).toBeVisible({ timeout: 20_000 })

    // Two waits, because Cancel is live from the first phase: clicking too early
    // aborts a turn that never reached the embedder and still passes, silently
    // retiring the coverage. First the revalidation commit — everything ahead of
    // the embed is behind it, and the embed IPC dispatches as its reply resolves.
    await expect.poll(() => staleEntities(app), { timeout: 60_000, intervals: [100] }).toBe(0)
    // Then a blocked main, which is positive proof the embed itself is running —
    // nothing else in the app parks the main process in synchronous native code.
    await expect
      .poll(
        async () => {
          const startedAt = Date.now()
          await queryApp(app.window, `SELECT 1`)
          return Date.now() - startedAt
        },
        { timeout: 60_000, intervals: [50] },
      )
      .toBeGreaterThan(MAIN_BLOCKED_MS)

    await reader.cancel(app.window).click()

    // A main that never saw the cancel reaches Send too — but only after every
    // filler row is embedded and committed, since the renderer waits the call out.
    await expect(reader.send(app.window)).toBeVisible({ timeout: 60_000 })

    // Exactly zero, not `< 320`: partial success is impossible (service.ts drops
    // every accumulated vector on abort), and a loose bound would also pass on a
    // turn that never reached the embedder. Read rather than polled — the drain
    // restarting behind the cancel needs all 20 chunks to erase this.
    expect(await fillerRows(app, 0), 'a cancelled embed clears no flags').toBe(0)
    // The other half of no-partial-success: not one vector was committed either.
    expect(await fillerVectors(app), 'a cancelled embed commits no vectors').toBe(0)

    // The sync stage returns ok:false for a cancel too, so the only thing keeping
    // the turn off the failure path is per-turn-retrieval's outer-signal check.
    await expect(reader.switchEmbedderFix(app.window)).toHaveCount(0)
    const failures = await queryApp(
      app.window,
      `SELECT count(*) FROM story_entries
        WHERE branch_id = ? AND json_extract(metadata, '$.systemFailure') IS NOT NULL`,
      [HERO_BRANCH],
    )
    expect(Number((failures[0] as [number])[0]), 'a cancel writes no failure entry').toBe(0)

    // The draft is handed back for edit/re-send — what the outer-signal check
    // above exists to preserve, and the only read-back of RAW.
    await expect(reader.composer(app.window)).toHaveValue(new RegExp('E2E-EMBED-CANCEL'))
  })
})
