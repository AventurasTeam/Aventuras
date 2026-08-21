import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm, type MockRequest } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  markBranchEmbeddingStale,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'

const REPLY = 'E2E-RETRIEVAL-REPLY — the amulet answers, warm against the rib.'

// Deliberately on top of hap_ambush ("The alley ambush / Vorne's people corner
// Kael; Mira pulls him clear"): this string IS Q1, and a happening only reaches
// the bundle by clearing RANKER_DEFAULTS.minScoreThreshold. No E2E marker
// prefix — it would be noise in the embedded query, and nothing reads it back.
const ACTION = 'Ask Mira what really happened during the alley ambush.'

const AWARENESS_SUM_SQL = `SELECT COALESCE(SUM(retrieval_count), 0) FROM happening_awareness WHERE branch_id = ?`
const AWARENESS_DELTA_SQL = `SELECT count(*) FROM deltas WHERE branch_id = ? AND target_table = 'happening_awareness'`

// The whole retrieval seam on one turn: the blocking sync stage embeds the
// branch's dirty rows, KNN + the ranker build a bundle, the bundle reaches the
// prompt the app actually sends, and the happenings it injected bump
// retrieval_count through a reversible delta. See docs/memory/retrieval.md.
test.describe('retrieval — a turn injects a retrieved bundle', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let dim: number

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    ;({ dim } = await installEmbedderModel(userDataDir))
    // Redundant while the seed leaves every happening stale — kept so a clean seed can't
    // silently stop this spec populating happenings_vec_*, its only DB-observable effect.
    markBranchEmbeddingStale(seeded.dbPath, HERO_BRANCH)
    mock = await startMockLlm()
    mock.setNarrative(REPLY)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  async function scalar(sql: string, params: unknown[] = []): Promise<number> {
    const [[value]] = await queryApp(app.window, sql, params)
    return Number(value)
  }

  // The mock records the request body verbatim; the prompt never renders, so
  // this is the only place to observe it. Stringified rather than re-flattened
  // per message: the headers below are distinctive enough that the surrounding
  // JSON escaping cannot manufacture a false match.
  function promptOf(request: MockRequest): string {
    return JSON.stringify(request.body)
  }

  test('embeds the branch, injects a ranked bundle, and bumps retrieval_count reversibly', async () => {
    // A real embed pass over every row on the branch precedes the turn.
    test.setTimeout(180_000)
    // Guards the vec0 table name asserted below against a catalog dim change.
    expect(dim).toBe(384)

    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    const awarenessBefore = await scalar(AWARENESS_SUM_SQL, [HERO_BRANCH])
    // Nothing has retrieved on this branch yet, so a bump is the only writer
    // that can move either number.
    expect(await scalar(AWARENESS_DELTA_SQL, [HERO_BRANCH]), 'no seeded awareness deltas').toBe(0)

    // Submitted without waiting for the background drain on purpose: the sync
    // stage is blocking, so the bundle below is complete whatever the drain has
    // reached — and the drain bails at its next batch boundary once the run is
    // active (lib/embedder/drain.ts), leaving the sync as the writer in flight.
    await reader.composer(app.window).fill(ACTION)
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-RETRIEVAL-REPLY', { exact: false })).toBeVisible({
      timeout: 90_000,
    })

    // Every happening on the branch is embedded and KNN-readable. Compared
    // against the source count, not `> 0`: a sync that embedded one table's
    // first batch and stopped would still pass a bare non-zero check.
    const happenings = await scalar(`SELECT count(*) FROM happenings WHERE branch_id = ?`, [
      HERO_BRANCH,
    ])
    expect(happenings, 'the seed has happenings to embed').toBeGreaterThan(0)
    expect(
      await scalar(`SELECT count(*) FROM happenings_vec_384 WHERE branch_id = ?`, [HERO_BRANCH]),
      'a vector per happening on the branch',
    ).toBe(happenings)

    const narrative = mock.requests.findLast((r) => r.streamed)
    expect(narrative, 'a streaming narrative call was made').toBeDefined()
    const prompt = promptOf(narrative!)
    // Ranker output: `# What has happened` has exactly one source,
    // retrievedHappenings (lib/prompts/bundled/memory-blocks.ts), which is the
    // selected happenings bundle and nothing else.
    expect(prompt, 'the retrieved happenings block reached the prompt').toContain(
      '# What has happened',
    )
    // Structural floor, not the ranker — but it is still retrieval's output: a
    // failed pass leaves generation-context's floor undefined and every pinned
    // bundle empty, so the header disappears with it.
    expect(prompt, 'the structural lore floor reached the prompt').toContain('# Relevant lore')

    // Injecting a happening bumps the awareness rows behind it. Only rows whose
    // character is in scene are loaded, so this can only move if the POV scope,
    // the ranker and the delta writer all agreed.
    const awarenessAfter = await scalar(AWARENESS_SUM_SQL, [HERO_BRANCH])
    expect(awarenessAfter, 'retrieval_count advanced').toBeGreaterThan(awarenessBefore)
    // Each bump is +1 and carries exactly one delta, so the log and the counters
    // have to agree — a bump written outside the delta layer, or a delta that
    // moved a counter by more than one, breaks the equality and not the
    // inequality above.
    expect(
      await scalar(AWARENESS_DELTA_SQL, [HERO_BRANCH]),
      'one logged delta per counted bump',
    ).toBe(awarenessAfter - awarenessBefore)

    // The slice's acceptance criterion: the bump is reversible. The turn's
    // reversal window is anchored at the user_action's create delta, which the
    // bumps sit after, so one undo has to take them with it.
    await reader.actionsTrigger(app.window).click()
    await reader.undoRow(app.window).click()
    await expect
      .poll(async () => scalar(AWARENESS_SUM_SQL, [HERO_BRANCH]), { timeout: 15_000 })
      .toBe(awarenessBefore)
  })
})
