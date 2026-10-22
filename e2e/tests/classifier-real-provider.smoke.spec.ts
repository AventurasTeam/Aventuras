import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, setClassifierCadence } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// The periodic classifier against a REAL provider: cadence 2 over a parked backlog, so the first
// Send runs a pass over the fixture's own prose before its turn, and the landed turn chains its own.
// Opt-in — needs a local OpenAI-compatible server, so it skips unless SMOKE_LLM_URL is set:
//   SMOKE_LLM_URL=http://localhost:5001/v1 SMOKE_LLM_MODEL=<id> pnpm test:e2e classifier-real-provider
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL

// With no profile timeout, as here, a pass's call expires at PASS_TIMEOUT_DEFAULT_MS
// (lib/pipeline/definitions/periodic-classifier.ts), which a spec can't import; the margin covers
// reconcile's embeds and the write burst after it.
const PASS_WAIT_MS = 600_000 + 60_000
// One Send's turn: the composer turning editable, then the run settling.
const EDITABLE_WAIT_MS = 120_000
const TURN_SETTLE_MS = 240_000
// A run's row is inserted right after what starts it (a Send's click, a turn's commit); none by
// then means none started.
const ROW_WAIT_MS = 15_000
const PERIODIC = 'periodic-classifier'

const PROMPTS = [
  'I ask Mira who bought the amulet.',
  'I follow the name down to the waterline.',
  'I draw the blade when the broker reaches for the satchel.',
  'I take the satchel and run for the keep.',
  'I bar the door behind me and catch my breath.',
]

test.describe('periodic classifier — real provider smoke', () => {
  test.skip(!LLM_URL || !LLM_MODEL, 'set SMOKE_LLM_URL and SMOKE_LLM_MODEL to run')

  let app: LaunchedApp
  let userDataDir: string | undefined
  const logs: { kind: string; text: string }[] = []
  // Captured where it is written, not re-read later: the pass can complete before the test
  // reads it back, and a post-hoc baseline would already hold the advanced value.
  let parkedWatermark = 0
  // The fixture logs its own periodic_classifier happening; this run's writes sit above its log.
  let seededLogHead = 0

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
    const head = new DatabaseSync(seeded.dbPath)
    try {
      // The seed parks the watermark at the last prose row. Parked 12 positions below the head
      // instead, the fixture's own prose is owed at the first Send, which runs its pass over real
      // narrative before the turn. Driving turns until the cadence comes due instead makes the
      // smoke hostage to per-turn failures that are not this pass's.
      const { m } = head
        .prepare(
          `SELECT COALESCE(MAX(position), 0) - 12 AS m FROM story_entries WHERE branch_id = ?`,
        )
        .get('br_hero_main') as { m: number }
      head
        .prepare(
          `UPDATE branches SET classifier_status = json_set(
             COALESCE(classifier_status, '{}'), '$.state', 'idle', '$.lastSuccessAt', NULL,
             '$.lastError', NULL, '$.processedThrough', ?)
           WHERE id = 'br_hero_main'`,
        )
        .run(m)
      parkedWatermark = m
      const { lp } = head
        .prepare(`SELECT COALESCE(MAX(log_position), 0) AS lp FROM deltas WHERE branch_id = ?`)
        .get('br_hero_main') as { lp: number }
      seededLogHead = lp
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

  test('a real model classifies the owed backlog before its turn, then the pass the turn chains', async () => {
    // Each Send may run its owed pass, then its turn; a landed turn's commit chains a pass, twice
    // at most (a failed one is owed again at the next Send); the reports take the rest.
    test.setTimeout(
      PROMPTS.length * (EDITABLE_WAIT_MS + ROW_WAIT_MS + PASS_WAIT_MS + TURN_SETTLE_MS) +
        2 * (ROW_WAIT_MS + PASS_WAIT_MS) +
        120_000,
    )
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 30_000 })

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    const count = async (sql: string, params: unknown[] = []): Promise<number> =>
      (await queryApp(app.window, sql, params))[0][0] as number
    // Counted on ai_reply alone: submitting a turn prunes the branch's `system`
    // rows, so a total-row count moves in both directions.
    const replies = () =>
      count(`SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'`, [
        branchId,
      ])
    const settledTurns = () =>
      count(`SELECT COUNT(*) FROM pipeline_runs WHERE kind = 'per-turn' AND outcome IS NOT NULL`)
    const classifierStatus = async (): Promise<{
      state: string
      processedThrough: number | null
    }> =>
      JSON.parse(
        (
          await queryApp(app.window, `SELECT classifier_status FROM branches WHERE id = ?`, [
            branchId,
          ])
        )[0][0] as string,
      )
    // In insertion order a Send's owed pass lands before its turn's row, and a turn's chained
    // pass after it.
    type RunRow = [
      rowid: number,
      kind: string,
      startedAt: number,
      finishedAt: number | null,
      outcome: string | null,
    ]
    const RUN_COLUMNS = 'rowid, kind, started_at, finished_at, outcome'
    const runsAfter = async (rowid: number): Promise<RunRow[]> =>
      (await queryApp(
        app.window,
        `SELECT ${RUN_COLUMNS} FROM pipeline_runs WHERE rowid > ? ORDER BY rowid`,
        [rowid],
      )) as RunRow[]
    const runAt = async (rowid: number): Promise<RunRow> =>
      (
        (await queryApp(app.window, `SELECT ${RUN_COLUMNS} FROM pipeline_runs WHERE rowid = ?`, [
          rowid,
        ])) as RunRow[]
      )[0]!
    const lastRowid = () => count(`SELECT COALESCE(MAX(rowid), 0) FROM pipeline_runs`)
    const systemEntryId = async (): Promise<string | null> =>
      ((
        await queryApp(
          app.window,
          `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
          [branchId],
        )
      )[0]?.[0] as string | undefined) ?? null

    let passCount = 0
    // Waits the pass out and writes its ### passes line as it settles, so a later throw keeps it.
    const settlePass = async (
      label: string,
      rowid: number,
      from: number,
    ): Promise<{ outcome: string | null; to: number }> => {
      await expect
        .poll(async () => (await runAt(rowid))[4], {
          timeout: PASS_WAIT_MS,
          intervals: [3000],
          message: `the ${label} pass did not settle within one call bound`,
        })
        .not.toBeNull()
      // A failed burst commits the run's failed marker before onPhaseException writes `failed`.
      await expect
        .poll(async () => (await classifierStatus()).state, { timeout: 10_000 })
        .not.toBe('running')
      const [, , startedAt, finishedAt, outcome] = await runAt(rowid)
      const to = (await classifierStatus()).processedThrough ?? 0
      const entries = await count(
        `SELECT COUNT(*) FROM story_entries
         WHERE branch_id = ? AND kind <> 'system' AND position > ? AND position <= ?`,
        [branchId, from, to],
      )
      process.stdout.write(
        `pass ${++passCount} (${label}): ${outcome} after ` +
          `${(((finishedAt ?? startedAt) - startedAt) / 1000).toFixed(1)} s, ` +
          `watermark ${from} -> ${to}, ${entries} entries classified\n`,
      )
      return { outcome, to }
    }

    let attempts = 0
    let beforeTurnPasses = 0
    let refusedSends = 0
    // classifier.md → Failure policy: an owed pass runs first, as its own run, and failing there
    // fails the Send (a system entry, no turn). Returns the Send's turn row, null when it never
    // reached one, and the watermark that turn ran over.
    const sendOnce = async (): Promise<{ turnRow: number | null; from: number }> => {
      expect(attempts, 'every prompt spent without a reply landing').toBeLessThan(PROMPTS.length)
      // The textarea is editable once hydrated; the Send click below waits for an enabled
      // Send, which is what outlasts a failed turn's reversal sweep.
      await expect(reader.composer(app.window)).toBeEditable({ timeout: EDITABLE_WAIT_MS })
      const since = await lastRowid()
      const settled = await settledTurns()
      const priorEntry = await systemEntryId()
      let from = (await classifierStatus()).processedThrough ?? 0
      await reader.composer(app.window).fill(PROMPTS[attempts]!)
      attempts++
      await reader.send(app.window).click()
      const turnRow = async () =>
        (await runsAfter(since)).find((r) => r[1] === 'per-turn')?.[0] ?? null
      // The click clears an earlier entry before anything runs, so a missing one reads as unchanged.
      const refused = async () =>
        (await turnRow()) === null && ((await systemEntryId()) ?? priorEntry) !== priorEntry
      const startedPassOrTurn = async () =>
        (await runsAfter(since)).some((r) => r[1] === PERIODIC || r[1] === 'per-turn')
      await expect
        .poll(async () => (await startedPassOrTurn()) || (await refused()), {
          timeout: ROW_WAIT_MS,
          message: 'the Send started neither a pass nor a turn',
        })
        .toBe(true)
      // The owed pass is the one inserted ahead of the Send's turn row.
      const runs = await runsAfter(since)
      const turnAt = runs.findIndex((r) => r[1] === 'per-turn')
      const owed = runs
        .slice(0, turnAt === -1 ? runs.length : turnAt)
        .find((r) => r[1] === PERIODIC)
      if (owed) {
        beforeTurnPasses++
        from = (await settlePass('before its turn', owed[0], from)).to
      }
      // Settle on the run's outcome, never the reply row: the narrative phase commits prose
      // before later phases, so a reply can appear, then be reversed when a later action fails.
      await expect
        .poll(async () => (await settledTurns()) > settled || (await refused()), {
          timeout: TURN_SETTLE_MS,
          intervals: [2000],
        })
        .toBe(true)
      const row = await turnRow()
      if (row === null) refusedSends++
      return { turnRow: row, from }
    }

    // A real model fails turns (an entity patch restating current state is rejected and takes the
    // run down), and a failed owed pass fails its Send: send again until a reply lands. Each resend
    // runs the still-owed pass first again.
    const landTurn = async (): Promise<{ turnRow: number; from: number }> => {
      const target = (await replies()) + 1
      let sent = await sendOnce()
      while ((await replies()) < target) sent = await sendOnce()
      if (sent.turnRow === null) throw new Error('a reply landed with no turn run behind it')
      return { turnRow: sent.turnRow, from: sent.from }
    }

    // A standing deferral or a failed chain leaves no pass row; say so here rather than as a hung
    // pass after the full wait.
    const chainedPass = async (turn: { turnRow: number; from: number }): Promise<string | null> => {
      await expect
        .poll(async () => (await runsAfter(turn.turnRow)).some((r) => r[1] === PERIODIC), {
          timeout: ROW_WAIT_MS,
          message: "the landed turn's commit chained no pass",
        })
        .toBe(true)
      const pass = (await runsAfter(turn.turnRow)).find((r) => r[1] === PERIODIC)!
      return (await settlePass('chained', pass[0], turn.from)).outcome
    }

    process.stdout.write('\n### passes\n')
    const firstChain = await chainedPass(await landTurn())
    expect(beforeTurnPasses, 'the first Send ran no pass over the parked backlog').toBeGreaterThan(
      0,
    )
    // classifier.md → Failure policy: a failed pass is owed again, and the next Send runs it first.
    if (firstChain === 'failed') await chainedPass(await landTurn())
    const failedTurns = await count(
      `SELECT COUNT(*) FROM pipeline_runs WHERE kind = 'per-turn' AND outcome = 'failed'`,
    )
    process.stdout.write(
      `\n### turns: ${attempts} attempts (${failedTurns} run failures, ` +
        `${refusedSends} Sends refused by their pass)\n`,
    )
    expect(
      (await classifierStatus()).processedThrough ?? 0,
      'watermark never passed where beforeAll parked it (see ### passes)',
    ).toBeGreaterThan(parkedWatermark)

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
         AND target_table = 'happenings' AND op = 'create' AND log_position > ${seededLogHead}`

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
    expect(JSON.parse(status).state).not.toBe('failed')
  })
})
