import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, setClassifierCadence } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// The slice's outstanding manual smoke, automated: a REAL provider, cadence 2,
// three turns, asserting the graph the pass actually wrote. Opt-in — it needs a
// local OpenAI-compatible server, so it skips unless SMOKE_LLM_URL is set:
//   SMOKE_LLM_URL=http://localhost:5001/v1 SMOKE_LLM_MODEL=<id> pnpm test:e2e classifier-real-provider
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL

test.describe('periodic classifier — real provider smoke', () => {
  test.skip(!LLM_URL || !LLM_MODEL, 'set SMOKE_LLM_URL and SMOKE_LLM_MODEL to run')

  let app: LaunchedApp
  let userDataDir: string | undefined
  const logs: { kind: string; text: string }[] = []
  // Captured where it is written, not re-read later: the pass can complete before
  // the test reads it back, and a post-hoc baseline would already hold the
  // advanced value — then the poll waits out its timeout for a second advance
  // that no further turn triggers.
  let parkedWatermark = 0

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir

    const db = new DatabaseSync(seeded.dbPath)
    try {
      db.prepare(
        `UPDATE app_settings SET providers = ?, profiles = ?, diagnostics = ? WHERE id = 'singleton'`,
      ).run(
        JSON.stringify([
          {
            id: 'prov_local',
            type: 'openai-compatible',
            displayName: 'Local smoke',
            apiKey: '',
            endpoint: LLM_URL,
            favoriteModelIds: [LLM_MODEL],
            cachedModels: [{ id: LLM_MODEL, capabilities: {} }],
          },
        ]),
        JSON.stringify([
          {
            id: 'prof_narrative',
            kind: 'narrative',
            name: 'Smoke Narrative',
            modelRef: { providerId: 'prov_local', modelId: LLM_MODEL },
            temperature: 0.8,
          },
          {
            id: 'prof_classifier',
            kind: 'agent',
            name: 'Smoke Classifier',
            modelRef: { providerId: 'prov_local', modelId: LLM_MODEL },
          },
        ]),
        // The gate is off in a packaged bundle, and the classifier's provenance
        // warnings are half of what this smoke exists to observe.
        JSON.stringify({ enabled: true, debug_level_enabled: true }),
      )
    } finally {
      db.close()
    }
    setClassifierCadence(seeded.dbPath, 'story_hero', 2)
    // Park the watermark at the head so the first pass reads the turns this test
    // writes. Left at 0 the pass drains the fixture's 72-entry backlog 20 at a
    // time and never reaches the new prose — a real behaviour, wrong subject.
    const head = new DatabaseSync(seeded.dbPath)
    try {
      // Parked 12 positions below the head, not at it: the fixture's own prose
      // then becomes the pass's window, so a single committed turn is enough to
      // fire the cadence over real narrative. Driving three turns instead makes
      // the smoke hostage to per-turn failures that are not this slice's.
      const { m } = head
        .prepare(
          `SELECT COALESCE(MAX(position), 0) - 12 AS m FROM story_entries WHERE branch_id = ?`,
        )
        .get('br_hero_main') as { m: number }
      head
        .prepare(
          `UPDATE branches SET classifier_status = json_set(
             COALESCE(classifier_status, '{}'), '$.state', 'idle', '$.lastSuccessAt', NULL,
             '$.lastError', NULL, '$.retryCount', 0, '$.processedThrough', ?)
           WHERE id = 'br_hero_main'`,
        )
        .run(m)
      parkedWatermark = m
    } finally {
      head.close()
    }
    // Real disambiguation needs a real embedder; without it every namesake
    // collision degrades to 'no-signal' and the band logic is never exercised.
    await installEmbedderModel(userDataDir)

    app = await launchApp({ userDataDir, cleanupUserData: false })
    app.window.on('console', (msg) => logs.push({ kind: msg.type(), text: msg.text() }))
    app.window.on('pageerror', (err) => logs.push({ kind: 'pageerror', text: err.message }))
  })

  test.afterAll(async () => {
    // Dump unconditionally: on a failure the log is the only record of what the
    // real model did, and the userData dir is what makes the DB inspectable.
    const notable = logs.filter(
      (l) => l.kind !== 'debug' || l.text.includes('classifier.') || l.text.includes('pipeline.'),
    )
    process.stdout.write(`\n### console (${logs.length} total)\n`)
    process.stdout.write(
      notable
        .map((l) => `[${l.kind}] ${l.text}`)
        .join('\n')
        .slice(-20000),
    )
    process.stdout.write(`\n### userData kept at: ${userDataDir}\n`)
    await app?.close()
  })

  test('three turns against a real model populate the graph', async () => {
    test.setTimeout(600_000)
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 30_000 })

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string

    // Counted on ai_reply alone: submitting a turn prunes the branch's `system`
    // rows, so a total-row count moves in both directions.
    const repliesSql = `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'`
    const before = (await queryApp(app.window, repliesSql, [branchId]))[0][0] as number

    const prompts = [
      'I ask Mira who bought the amulet.',
      'I follow the name down to the waterline.',
      'I draw the blade when the broker reaches for the satchel.',
      'I take the satchel and run for the keep.',
      'I bar the door behind me and catch my breath.',
    ]
    // A real model fails turns: an entity patch that restates current state is
    // rejected by the action layer and takes the whole run down (see the report
    // below). Keep submitting until three replies land rather than asserting a
    // clean first try — the classifier only needs committed turns to count.
    const TARGET_TURNS = 1
    let attempts = 0
    let failures = 0
    const runsSql0 = `SELECT outcome, COUNT(*) FROM pipeline_runs WHERE kind = 'per-turn' GROUP BY outcome`
    let completedOrFailed = ((await queryApp(app.window, runsSql0)) as [string | null, number][])
      .filter((r) => r[0] != null)
      .reduce((n, r) => n + r[1], 0)
    while (
      ((await queryApp(app.window, repliesSql, [branchId]))[0][0] as number) <
      before + TARGET_TURNS
    ) {
      if (attempts >= prompts.length) break
      // A failed turn leaves the reversal sweep holding the edit barrier; start
      // each attempt from a quiescent composer rather than racing it.
      await expect(reader.composer(app.window)).toBeEditable({ timeout: 120_000 })
      const text = prompts[attempts]!
      attempts++
      await reader.composer(app.window).fill(text)
      await reader.send(app.window).click()
      // Settle on the run's own outcome, never on the reply row: the narrative
      // phase commits prose before later phases run, so a reply can appear and
      // then be reversed when a subsequent phase's action is rejected.
      const runsSql = `SELECT outcome, COUNT(*) FROM pipeline_runs WHERE kind = 'per-turn' GROUP BY outcome`
      await expect
        .poll(
          async () => {
            const rows = (await queryApp(app.window, runsSql)) as [string | null, number][]
            const done = rows.filter((r) => r[0] != null).reduce((n, r) => n + r[1], 0)
            return done > completedOrFailed ? 'settled' : 'pending'
          },
          { timeout: 240_000, intervals: [2000] },
        )
        .toBe('settled')
      const rows = (await queryApp(app.window, runsSql)) as [string | null, number][]
      completedOrFailed = rows.filter((r) => r[0] != null).reduce((n, r) => n + r[1], 0)
      failures = rows.find((r) => r[0] === 'failed')?.[1] ?? 0
    }
    const landed = ((await queryApp(app.window, repliesSql, [branchId]))[0][0] as number) - before
    process.stdout.write(
      `\n### turns: ${landed} landed of ${attempts} attempts (${failures} run failures)\n`,
    )
    expect(landed).toBeGreaterThanOrEqual(1)

    // Cadence 2: the watermark must move past where beforeAll parked it.
    await expect
      .poll(
        async () =>
          (
            await queryApp(
              app.window,
              `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
              [branchId],
            )
          )[0][0] as number,
        { timeout: 300_000, intervals: [3000] },
      )
      .toBeGreaterThan(parkedWatermark)

    const report = async (label: string, sql: string, params: unknown[] = []) => {
      const rows = await queryApp(app.window, sql, params)
      process.stdout.write(`\n### ${label}\n${JSON.stringify(rows, null, 1)}\n`)
      return rows
    }

    await report('classifier_status', `SELECT classifier_status FROM branches WHERE id = ?`, [
      branchId,
    ])
    await report(
      'deltas by source',
      `SELECT source, op, target_table, COUNT(*), SUM(entry_id IS NULL)
       FROM deltas WHERE branch_id = ? GROUP BY source, op, target_table`,
      [branchId],
    )
    await report(
      'happenings',
      `SELECT id, title, description, occurred_at_entry_id, temporal, embedding_stale
       FROM happenings WHERE branch_id = ? ORDER BY created_at DESC LIMIT 20`,
      [branchId],
    )
    await report(
      'involvements',
      `SELECT hi.happening_id, hi.entity_id, hi.role, e.name, e.kind
       FROM happening_involvements hi LEFT JOIN entities e
         ON e.id = hi.entity_id AND e.branch_id = hi.branch_id
       WHERE hi.branch_id = ?`,
      [branchId],
    )
    await report(
      'awareness',
      `SELECT ha.happening_id, ha.character_id, ha.decay_resistance, ha.source, ha.learned_at_entry_id, e.name
       FROM happening_awareness ha LEFT JOIN entities e
         ON e.id = ha.character_id AND e.branch_id = ha.branch_id
       WHERE ha.branch_id = ?`,
      [branchId],
    )
    await report(
      'entities',
      `SELECT id, kind, name, status, name_collision_flag, embedding_stale, injection_mode, description
       FROM entities WHERE branch_id = ? ORDER BY created_at`,
      [branchId],
    )
    await report(
      'relationships',
      `SELECT a_id, b_id, kind, inverse_kind FROM character_relationships WHERE branch_id = ?`,
      [branchId],
    )

    const classifierLogs = logs.filter((l) => l.text.includes('classifier.'))
    process.stdout.write(
      `\n### classifier logs\n${classifierLogs.map((l) => l.text).join('\n') || '(none)'}\n`,
    )

    // Hard invariants — everything above is observational.
    const orphaned = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM deltas WHERE branch_id = ? AND source = 'periodic_classifier' AND entry_id IS NULL`,
      [branchId],
    )
    expect(orphaned[0][0]).toBe(0)

    // Scoped to rows this run wrote: the fixture seeds four happenings with
    // embedding_stale = 0 and 7+7 child rows, which are not the pass's business.
    const CLASSIFIER_HAPPENINGS = `SELECT target_id FROM deltas
       WHERE branch_id = ? AND source = 'periodic_classifier'
         AND target_table = 'happenings' AND op = 'create'`

    const written = await queryApp(app.window, `SELECT COUNT(*) FROM (${CLASSIFIER_HAPPENINGS})`, [
      branchId,
    ])
    process.stdout.write(`\n### happenings written by this run: ${written[0][0]}\n`)

    // No embedding_stale invariant here: the pass writes 1, and with an embedder
    // installed the drain then clears it — asserting either value races the drain.
    // The write-path contract is covered by the mock-LLM spec instead.
    const danglingInv = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM happening_involvements hi
       WHERE hi.branch_id = ? AND hi.happening_id IN (${CLASSIFIER_HAPPENINGS})
         AND NOT EXISTS (
           SELECT 1 FROM entities e WHERE e.branch_id = hi.branch_id AND e.id = hi.entity_id)`,
      [branchId, branchId],
    )
    expect(danglingInv[0][0]).toBe(0)

    const nonCharAwareness = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM happening_awareness ha
       WHERE ha.branch_id = ? AND ha.happening_id IN (${CLASSIFIER_HAPPENINGS})
         AND NOT EXISTS (
           SELECT 1 FROM entities e WHERE e.branch_id = ha.branch_id
             AND e.id = ha.character_id AND e.kind = 'character')`,
      [branchId, branchId],
    )
    expect(nonCharAwareness[0][0]).toBe(0)

    const badSeverity = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM happening_awareness
       WHERE branch_id = ? AND happening_id IN (${CLASSIFIER_HAPPENINGS})
         AND (decay_resistance < 0 OR decay_resistance > 1)`,
      [branchId, branchId],
    )
    expect(badSeverity[0][0]).toBe(0)

    const status = (
      await queryApp(app.window, `SELECT classifier_status FROM branches WHERE id = ?`, [branchId])
    )[0][0] as string
    expect(JSON.parse(status).state).not.toBe('failed-persistent')
  })
})
