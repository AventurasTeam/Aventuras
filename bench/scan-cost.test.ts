import { describe, it } from 'vitest'

import { readUnfinishedRuns } from '@/lib/actions'
import { vecRowPk, vectorsByIdQuery } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { median } from './fixture'

// Cost harness, not a test — it asserts nothing. Run with `pnpm bench:scan` when a change moves how
// a vec0 table is read outside KNN (lib/db/embeddings/knn.ts, ops.ts) or how the unfinished-run
// reads find their rows (lib/actions/delta/unfinished-runs.ts). Times the node:sqlite connection
// the desktop main process runs.

const RUNS = 5
const DIM = 384
const MODEL = 'bench-model'
const BRANCH = 'br_read'
const PER_BRANCH = 3_000
// Other branches at the dim: every story's, and every fork's copy of its parent.
const OTHER_BRANCHES = [0, 4, 19]
const IDS = 100
const RUN_ROWS = [10_000, 50_000, 100_000]
const READ_BRANCH = 'br_3'
// Coprime to the 20 branches, so the unfinished runs spread over all of them, the read branch too.
const UNFINISHED_EVERY = 1001

function timed(fn: () => unknown): number {
  const samples: number[] = []
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  return median(samples)
}

async function timedAsync(fn: () => Promise<unknown>): Promise<number> {
  const samples: number[] = []
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now()
    await fn()
    samples.push(performance.now() - start)
  }
  return median(samples)
}

describe('scan cost', () => {
  it('vec0 by-id read and delete, the read branch held at 3,000 rows', async () => {
    const lines: string[] = []
    for (const others of OTHER_BRANCHES) {
      const { sqlite } = await createTestDb()
      const table = `entities_vec_${DIM}`
      const insert = sqlite.prepare(
        `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      const vector = new Float32Array(DIM)
      vector[0] = 1
      const bytes = new Uint8Array(vector.buffer)
      sqlite.exec('BEGIN')
      for (const branch of [BRANCH, ...Array.from({ length: others }, (_, b) => `br_${b}`)])
        for (let i = 0; i < PER_BRANCH; i += 1)
          insert.run(vecRowPk(branch, `e${i}`, MODEL), branch, MODEL, `e${i}`, 'h', bytes)
      sqlite.exec('COMMIT')
      const ids = Array.from({ length: IDS }, (_, i) => `e${i * 7}`)
      const read = vectorsByIdQuery('entity', DIM, { branchId: BRANCH, modelId: MODEL, ids })
      const byIds = timed(() => sqlite.prepare(read.sql).all(...(read.params as string[])))
      const byPk = timed(() =>
        sqlite.prepare(`SELECT id FROM ${table} WHERE pk = ?`).all(vecRowPk(BRANCH, 'e7', MODEL)),
      )
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${read.sql}`)
        .all(...(read.params as string[]))
        .map((row) => (row as { detail: string }).detail)
        .join('; ')
      const total = PER_BRANCH * (others + 1)
      lines.push(
        `  ${total} rows at dim ${DIM}: ${IDS} ids ${byIds.toFixed(1)} ms, one pk ${byPk.toFixed(2)} ms; plan: ${plan}`,
      )
    }
    process.stdout.write(`\nvec0 reads outside KNN\n${lines.join('\n')}\n\n`)
  }, 600_000)

  it('unfinished-run read, with and without a partial index on branch_id', async () => {
    const lines: string[] = []
    for (const rows of RUN_ROWS) {
      const { db, sqlite } = await createTestDb()
      sqlite.exec(
        `INSERT INTO stories (id, title, status, favorite, created_at, updated_at) VALUES ('s1', 'T', 'active', 0, 1, 1)`,
      )
      const insertBranch = sqlite.prepare(
        `INSERT INTO branches (id, story_id, name, created_at) VALUES (?, 's1', ?, 1)`,
      )
      for (let b = 0; b < 20; b += 1) insertBranch.run(`br_${b}`, `b${b}`)
      const insertRun = sqlite.prepare(
        `INSERT INTO pipeline_runs (run_id, kind, action_id, story_id, branch_id, started_at, finished_at, outcome)
         VALUES (?, 'generate', ?, 's1', ?, ?, ?, ?)`,
      )
      sqlite.exec('BEGIN')
      for (let i = 0; i < rows; i += 1) {
        const finished = i % UNFINISHED_EVERY !== 0
        insertRun.run(
          `run_${i}`,
          `act_${i}`,
          `br_${i % 20}`,
          i,
          finished ? i + 1 : null,
          finished ? 'completed' : null,
        )
      }
      sqlite.exec('COMMIT')
      const ctx = { db }
      const found = (await readUnfinishedRuns(READ_BRANCH, ctx)).length
      const plain = await timedAsync(() => readUnfinishedRuns(READ_BRANCH, ctx))
      sqlite.exec(
        'CREATE INDEX bench_unfinished_runs ON pipeline_runs (branch_id) WHERE finished_at IS NULL',
      )
      const indexed = await timedAsync(() => readUnfinishedRuns(READ_BRANCH, ctx))
      lines.push(
        `  ${rows} runs, ${found} unfinished on the read branch: ${plain.toFixed(2)} ms as shipped, ${indexed.toFixed(2)} ms with the partial index`,
      )
    }
    process.stdout.write(`\nunfinished-run read\n${lines.join('\n')}\n\n`)
  }, 600_000)
})
