import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, setClassifierCadence } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Periodic classifier, REAL provider: the first Send runs a pass before its turn, which chains one.
// Opt-in — needs a local OpenAI-compatible server, so it skips unless SMOKE_LLM_URL is set:
//   SMOKE_LLM_URL=http://localhost:5001/v1 SMOKE_LLM_MODEL=<id> pnpm test:e2e classifier-real-provider
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL

// No profile timeout: a pass's call expires at PASS_TIMEOUT_DEFAULT_MS, which a spec can't import
// (lib/pipeline/definitions/periodic-classifier.ts); +60 s covers reconcile's embeds and writes.
const PASS_WAIT_MS = 600_000 + 60_000
// A settled pass's status leaving `running`.
const STATUS_SETTLE_MS = 10_000
const COMPOSER_VISIBLE_MS = 30_000
// One Send's turn: the composer turning editable, then the run settling.
const EDITABLE_WAIT_MS = 120_000
const TURN_SETTLE_MS = 240_000
// A refused Send's text back in the composer, after its entry's write and reload.
const DRAFT_RETURN_MS = 30_000
// A run's row lands right after its trigger (a Send's click, a turn's commit); none = none started.
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
      // The seed parks the watermark at the last prose row; 12 below the head, the fixture's own
      // prose is owed at the first Send. Driving turns until cadence is due would make the smoke
      // hostage to per-turn failures that are not this pass's.
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
    // Per Send: owed pass, turn, and a refused one's wait for its text back. A landed turn chains a
    // pass, twice at most (a failed one is owed again at the next Send); the reports take the rest.
    test.setTimeout(
      COMPOSER_VISIBLE_MS +
        PROMPTS.length *
          (EDITABLE_WAIT_MS +
            ROW_WAIT_MS +
            PASS_WAIT_MS +
            STATUS_SETTLE_MS +
            TURN_SETTLE_MS +
            DRAFT_RETURN_MS) +
        2 * (ROW_WAIT_MS + PASS_WAIT_MS + STATUS_SETTLE_MS) +
        120_000,
    )
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: COMPOSER_VISIBLE_MS })

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
    // In insertion order a Send's owed pass lands before its turn's row, a chained pass after it.
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
    // `pass` is set only on an entry a pass's refusal wrote (toPassFailureMeta).
    type SystemEntry = { id: string; pass: 'held' | 'failed' | null; content: string }
    const systemEntry = async (): Promise<SystemEntry | null> => {
      const row = (
        await queryApp(
          app.window,
          `SELECT id, json_extract(metadata, '$.systemFailure.pass'), content
           FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
          [branchId],
        )
      )[0] as [string, SystemEntry['pass'], string] | undefined
      return row ? { id: row[0], pass: row[1], content: row[2] } : null
    }

    const passSettled = (label: string, rowid: number, interval: number) =>
      expect
        .poll(async () => (await runAt(rowid))[4], {
          timeout: PASS_WAIT_MS,
          intervals: [interval],
          message: `the ${label} pass did not settle within one call bound`,
        })
        .not.toBeNull()

    let passCount = 0
    // Writes the pass's ### passes line as it settles, so a later throw keeps it. A null watermark
    // is one the spec couldn't attribute to this pass.
    const reportPass = async (
      label: string,
      rowid: number,
      from: number | null,
      to: number | null,
    ): Promise<string | null> => {
      const [, , startedAt, finishedAt, outcome] = await runAt(rowid)
      const entries =
        from === null || to === null
          ? '?'
          : await count(
              `SELECT COUNT(*) FROM story_entries
               WHERE branch_id = ? AND kind <> 'system' AND position > ? AND position <= ?`,
              [branchId, from, to],
            )
      process.stdout.write(
        `pass ${++passCount} (${label}): ${outcome} after ` +
          `${(((finishedAt ?? startedAt) - startedAt) / 1000).toFixed(1)} s, ` +
          `watermark ${from ?? '?'} -> ${to ?? '?'}, ${entries} entries classified\n`,
      )
      return outcome
    }

    // Nothing starts another pass until the next Send, so the branch status is this pass's.
    const settleChainedPass = async (rowid: number, from: number | null) => {
      await passSettled('chained', rowid, 3000)
      // A failed burst commits the run's failed marker before onPhaseException writes `failed`.
      await expect
        .poll(async () => (await classifierStatus()).state, { timeout: STATUS_SETTLE_MS })
        .not.toBe('running')
      return reportPass('chained', rowid, from, (await classifierStatus()).processedThrough ?? 0)
    }

    // Settled by its own row: the turn runs on meanwhile, and its commit chains a pass that writes
    // `running`. The pass's watermark lands before its outcome, so only a later pass can move it.
    const settleOwedPass = async (rowid: number, from: number | null): Promise<number | null> => {
      await passSettled('before its turn', rowid, 500)
      const [[through, later]] = await queryApp(
        app.window,
        `SELECT COALESCE(json_extract(classifier_status, '$.processedThrough'), 0),
                EXISTS (SELECT 1 FROM pipeline_runs WHERE rowid > ? AND kind = ?)
         FROM branches WHERE id = ?`,
        [rowid, PERIODIC, branchId],
      )
      const to = later === 1 ? null : (through as number)
      await reportPass('before its turn', rowid, from, to)
      return to
    }

    let attempts = 0
    // Per Send, in order: whether it ran a pass before its turn.
    const ranPassFirst: boolean[] = []
    let refusedSends = 0
    // classifier.md → Failure policy: an owed pass runs first, as its own run; failing it fails the
    // Send (system entry, no turn). turnRow is null then; from is the watermark the turn ran over.
    const sendOnce = async (): Promise<{ turnRow: number | null; from: number | null }> => {
      // The textarea is editable once hydrated; the Send click below waits for an enabled
      // Send, which is what outlasts a failed turn's reversal sweep.
      await expect(reader.composer(app.window)).toBeEditable({ timeout: EDITABLE_WAIT_MS })
      const since = await lastRowid()
      const settled = await settledTurns()
      const priorEntryId = (await systemEntry())?.id ?? null
      let from: number | null = (await classifierStatus()).processedThrough ?? 0
      const prompt = PROMPTS[attempts]!
      await reader.composer(app.window).fill(prompt)
      attempts++
      await reader.send(app.window).click()
      const turnRow = async () =>
        (await runsAfter(since)).find((r) => r[1] === 'per-turn')?.[0] ?? null
      // The click's clear of an earlier entry hits main before the poll's first read: a renderer's
      // IPC is handled in order, by synchronous handlers. An entry with no turn row is this Send's.
      const turnlessFailure = async (): Promise<SystemEntry | null> => {
        if ((await turnRow()) !== null) return null
        const entry = await systemEntry()
        return entry !== null && entry.id !== priorEntryId ? entry : null
      }
      const failedWithoutTurn = async () => (await turnlessFailure()) !== null
      const startedPassOrTurn = async () =>
        (await runsAfter(since)).some((r) => r[1] === PERIODIC || r[1] === 'per-turn')
      await expect
        .poll(async () => (await startedPassOrTurn()) || (await failedWithoutTurn()), {
          timeout: ROW_WAIT_MS,
          message: 'the Send started neither a pass nor a turn',
        })
        .toBe(true)
      const runs = await runsAfter(since)
      const turnAt = runs.findIndex((r) => r[1] === 'per-turn')
      const owed = runs
        .slice(0, turnAt === -1 ? runs.length : turnAt)
        .find((r) => r[1] === PERIODIC)
      ranPassFirst.push(owed !== undefined)
      if (owed) from = await settleOwedPass(owed[0], from)
      // Settle on the run's outcome, never the reply row: the narrative phase commits prose
      // before later phases, so a reply can appear, then be reversed when a later action fails.
      await expect
        .poll(async () => (await settledTurns()) > settled || (await failedWithoutTurn()), {
          timeout: TURN_SETTLE_MS,
          intervals: [2000],
        })
        .toBe(true)
      const row = await turnRow()
      if (row !== null) return { turnRow: row, from }
      // Any other turnless failure (a rejected start, a rejected user_action write) is not the
      // pass's, and resending would absorb it.
      const entry = (await turnlessFailure())!
      if (entry.pass === null)
        throw new Error(`the Send failed with no turn, not by its pass: ${entry.content}`)
      // A held branch can't run a pass until a boot reverses its orphan; resending can't help.
      if (entry.pass === 'held') throw new Error(`the Send's pass is held: ${entry.content}`)
      refusedSends++
      // reader-composer.md → Custody of the turn's text: it goes back to the empty composer.
      await expect(reader.composer(app.window)).toHaveValue(prompt, { timeout: DRAFT_RETURN_MS })
      return { turnRow: null, from }
    }

    // A real model fails turns (an entity patch restating current state is rejected and fails the
    // run), and a failed owed pass fails its Send: resend until a reply lands, pass first again.
    const landTurn = async (label: string): Promise<{ turnRow: number; from: number | null }> => {
      const target = (await replies()) + 1
      let sent: { turnRow: number | null; from: number | null } | undefined
      while (sent === undefined || (await replies()) < target) {
        expect(
          attempts,
          `all ${PROMPTS.length} prompts spent before the ${label} reply landed`,
        ).toBeLessThan(PROMPTS.length)
        sent = await sendOnce()
      }
      if (sent.turnRow === null) throw new Error('a reply landed with no turn run behind it')
      return { turnRow: sent.turnRow, from: sent.from }
    }

    // A standing deferral or a failed chain leaves no pass row; fail here, not as a hung full wait.
    const chainedPass = async (turn: {
      turnRow: number
      from: number | null
    }): Promise<string | null> => {
      await expect
        .poll(async () => (await runsAfter(turn.turnRow)).some((r) => r[1] === PERIODIC), {
          timeout: ROW_WAIT_MS,
          message: "the landed turn's commit chained no pass",
        })
        .toBe(true)
      const pass = (await runsAfter(turn.turnRow)).find((r) => r[1] === PERIODIC)!
      return settleChainedPass(pass[0], turn.from)
    }

    process.stdout.write('\n### passes\n')
    let lastChain = await chainedPass(await landTurn('first'))
    // The first Send's flag alone: a resend can run a pass that Send skipped.
    expect(ranPassFirst[0], 'the first Send ran no pass over the parked backlog').toBe(true)
    // classifier.md → Failure policy: a failed pass is owed again, and the next Send runs it first.
    if (lastChain === 'failed') {
      const next = attempts
      lastChain = await chainedPass(await landTurn('second'))
      expect(
        ranPassFirst[next],
        'the Send after a failed chained pass ran no pass before its turn',
      ).toBe(true)
    }
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

    // `failed` is ordinary, owed at the next Send (classifier.md → Failure policy); the status may
    // read it only after a last pass that failed.
    if (lastChain !== 'failed') expect((await classifierStatus()).state).not.toBe('failed')
  })
})
