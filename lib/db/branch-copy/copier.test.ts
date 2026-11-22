import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { getTableColumns, ne, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import {
  branchSnapshot,
  cloneBranch,
  seedCopyFixture,
  type CopyFixture,
  type TestDb,
} from '../__tests__/two-branch'
import { ensureVecTablesSql, knnQuery, packFloat32, type VecTargetKind } from '../embeddings'
import { branches, deltas, entities, lore, storyEntries, threads } from '../schema'
import type { NewEntity, SqlOp } from '../types'
import { branchCopyOps, type BranchCopyArgs, type CopyPredicate } from './copier'
import { BRANCH_COPY_MANIFEST, type BranchCopyTableName } from './manifest'
import { vecCopyOps } from './vec-copy'

const COPY = 'br_c'

// Written from canon's manifest, in its copy order: deltas and journals after every other table.
const DUPLICATE_TABLES: readonly BranchCopyTableName[] = [
  'story_entries',
  'entities',
  'character_relationships',
  'lore',
  'threads',
  'happenings',
  'happening_involvements',
  'happening_awareness',
  'chapters',
  'branch_era_flips',
  'translations',
  'entry_assets',
  'deltas',
  'reversal_journals',
]

const FORK_FILTERED = ['story_entries', 'deltas', 'reversal_journals'] as const

// Stored text no drizzle write produces: odd spacing, keys out of order, non-ASCII.
const RAW_JSON = '{ "zeta" :  "ž – 日本",\n  "alpha": [2, 1] }'

let t: TestDb
let fx: CopyFixture

beforeEach(async () => {
  t = await createTestDb()
  fx = await seedCopyFixture(t)
})

// The caller's half of the batch: the copier writes no branches row.
function branchRowOp(id: string): SqlOp {
  return t.db
    .insert(branches)
    .values({ id, storyId: fx.storyId, parentBranchId: fx.branchId, name: id, createdAt: 2 })
    .toSQL()
}

function duplicateOps(where?: Partial<Record<BranchCopyTableName, CopyPredicate>>): SqlOp[] {
  return branchCopyOps(t.db, { from: fx.branchId, to: COPY, mode: 'duplicate', where })
}

// A branch's rows as stored (JSON as its text), branch_id dropped, in a stable order.
function rowsOf(sqlite: DatabaseSync, table: string, branchId: string): Record<string, unknown>[] {
  const rows = sqlite
    .prepare(`SELECT * FROM "${table}" WHERE branch_id = ?`)
    .all(branchId) as Record<string, unknown>[]
  return rows
    .map(({ branch_id: _branch, ...row }) => ({ key: JSON.stringify(row), row }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ row }) => row)
}

function countOn(sqlite: DatabaseSync, table: string, branchId: string): number {
  const found = sqlite
    .prepare(`SELECT count(*) AS n FROM "${table}" WHERE branch_id = ?`)
    .get(branchId) as { n: number }
  return found.n
}

function tableOf(op: SqlOp): string | undefined {
  return /^insert into "(\w+)"/.exec(op.sql)?.[1]
}

describe('branchCopyOps', () => {
  it('copies each table a duplicate copies onto the new branch, every column as stored', async () => {
    const [entity] = t.sqlite
      .prepare('SELECT id FROM entities WHERE branch_id = ? ORDER BY id LIMIT 1')
      .all(fx.branchId) as { id: string }[]
    const rawWrites = [
      ['entities', 'state', 'id', entity.id],
      ['deltas', 'undo_payload', 'action_id', fx.deleteActionId],
      ['reversal_journals', 'journal', 'action_id', fx.journalActionId],
    ] as const
    for (const [table, column, key, value] of rawWrites)
      t.sqlite
        .prepare(`UPDATE ${table} SET ${column} = ? WHERE branch_id = ? AND ${key} = ?`)
        .run(RAW_JSON, fx.branchId, value)
    const sourceBefore = branchSnapshot(t.sqlite, fx.branchId)

    const vectorOps = await vecCopyOps(t.db, { from: fx.branchId, to: COPY })
    await t.runInTransaction([branchRowOp(COPY), ...duplicateOps(), ...vectorOps])

    for (const table of DUPLICATE_TABLES) {
      const source = rowsOf(t.sqlite, table, fx.branchId)
      expect(source.length, table).toBeGreaterThan(0)
      expect(rowsOf(t.sqlite, table, COPY), table).toEqual(source)
    }
    for (const [table, column, key, value] of rawWrites) {
      const stored = (branchId: string) =>
        (
          t.sqlite
            .prepare(
              `SELECT ${column} AS text, hex(${column}) AS bytes FROM ${table} WHERE branch_id = ? AND ${key} = ?`,
            )
            .all(branchId, value) as { text: unknown; bytes: unknown }[]
        ).map(({ text, bytes }) => ({ text, bytes }))
      expect(stored(fx.branchId).length, table).toBeGreaterThan(0)
      expect(stored(COPY), table).toEqual(stored(fx.branchId))
      expect(new Set(stored(COPY).map(({ text }) => text)), table).toEqual(new Set([RAW_JSON]))
    }
    expect(countOn(t.sqlite, 'probe_captures', COPY)).toBe(0)
    expect(countOn(t.sqlite, 'probe_captures', fx.branchId)).toBe(fx.probeCaptureIds.length)
    expect(countOn(t.sqlite, 'pipeline_runs', COPY)).toBe(0)
    expect(branchSnapshot(t.sqlite, fx.branchId)).toEqual(sourceBefore)
  })

  it('names every column of each table in copy order, binding the new branch in branch_id', () => {
    const ops = duplicateOps()
    expect(ops.map(tableOf)).toEqual(DUPLICATE_TABLES)
    ops.forEach((op, i) => {
      const name = DUPLICATE_TABLES[i]
      const columns = Object.values(getTableColumns(BRANCH_COPY_MANIFEST[name].table)).map(
        (column) => column.name,
      )
      const inserted = columns.map((column) => `"${column}"`).join(', ')
      const selected = columns
        .map((column) => (column === 'branch_id' ? '?' : `"${name}"."${column}"`))
        .join(', ')
      expect(op.sql).toBe(
        `insert into "${name}" (${inserted}) select ${selected} from "${name}" where "${name}"."branch_id" = ?`,
      )
      expect(op.params).toEqual([COPY, fx.branchId])
    })
  })

  it("leaves a fork's trailing system entry out through its story_entries predicate", async () => {
    const ops = branchCopyOps(t.db, {
      from: fx.branchId,
      to: COPY,
      mode: 'fork',
      where: {
        story_entries: sql`${storyEntries.kind} != 'system'`,
        deltas: 'all',
        reversal_journals: 'all',
      },
    })
    expect(ops.map(tableOf)).toEqual(DUPLICATE_TABLES)

    await t.runInTransaction([branchRowOp(COPY), ...ops])

    const entryIds = (branchId: string) =>
      (
        t.sqlite
          .prepare('SELECT id FROM story_entries WHERE branch_id = ? ORDER BY position')
          .all(branchId) as { id: string }[]
      ).map(({ id }) => id)
    expect(entryIds(fx.branchId)).toContain(fx.systemEntryId)
    expect(entryIds(COPY)).toEqual(entryIds(fx.branchId).filter((id) => id !== fx.systemEntryId))
    // 'all' copies the whole table: a fork at the tail keeps every delta and journal.
    for (const table of ['deltas', 'reversal_journals']) {
      const source = rowsOf(t.sqlite, table, fx.branchId)
      expect(source.length, table).toBeGreaterThan(0)
      expect(rowsOf(t.sqlite, table, COPY), table).toEqual(source)
    }
  })

  it('leaves out exactly the deltas a correlated predicate names, reading tables copied before them', async () => {
    const [entity] = t.sqlite
      .prepare('SELECT id FROM entities WHERE branch_id = ? ORDER BY id LIMIT 1')
      .all(fx.branchId) as { id: string }[]
    const [{ top }] = t.sqlite
      .prepare('SELECT max(log_position) AS top FROM deltas WHERE branch_id = ?')
      .all(fx.branchId) as { top: number }[]
    // A write to a row the source still holds: kept only if the copy holds that row when deltas copy.
    await t.db.insert(deltas).values({
      id: 'delta_on_live_entity',
      branchId: fx.branchId,
      entryId: null,
      actionId: 'act_on_live_entity',
      logPosition: top + 1,
      source: 'user_edit',
      targetTable: 'entities',
      targetId: entity.id,
      op: 'update',
      undoPayload: { name: 'before' },
      createdAt: 1,
    })
    // Reads the copy's entities, so it holds only if entities copy before deltas in the batch.
    const targetOnCopy = sql`${deltas.targetTable} != 'entities' or exists (select 1 from ${entities} where ${entities.branchId} = ${COPY} and ${entities.id} = ${deltas.targetId})`
    const entityIds = new Set(
      (
        t.sqlite.prepare('SELECT id FROM entities WHERE branch_id = ?').all(fx.branchId) as {
          id: string
        }[]
      ).map(({ id }) => id),
    )
    const logged = t.sqlite
      .prepare('SELECT id, action_id, target_table, target_id FROM deltas WHERE branch_id = ?')
      .all(fx.branchId) as {
      id: string
      action_id: string
      target_table: string
      target_id: string
    }[]
    const kept = (delta: (typeof logged)[number]) =>
      delta.target_table !== 'entities' || entityIds.has(delta.target_id)
    // Not vacuous either way: the fixture's character delete names a row the source no longer
    // holds, and the write above names one it does.
    expect(logged.filter((delta) => !kept(delta)).map((delta) => delta.action_id)).toContain(
      fx.deleteActionId,
    )
    expect(logged.filter(kept).map(({ id }) => id)).toContain('delta_on_live_entity')

    await t.runInTransaction([branchRowOp(COPY), ...duplicateOps({ deltas: targetOnCopy })])

    const copied = (
      t.sqlite.prepare('SELECT id FROM deltas WHERE branch_id = ?').all(COPY) as { id: string }[]
    )
      .map(({ id }) => id)
      .sort()
    expect(copied).toEqual(
      logged
        .filter(kept)
        .map(({ id }) => id)
        .sort(),
    )
  })

  it('keeps a predicate with a top-level OR inside the source branch', async () => {
    // A sibling holding the same delta ids: an OR outside parentheses would select its rows too.
    cloneBranch(t.sqlite, fx.branchId, 'br_x')
    const always = sql`0 = 1 or 1 = 1`

    await t.runInTransaction([branchRowOp(COPY), ...duplicateOps({ deltas: always })])

    expect(rowsOf(t.sqlite, 'deltas', COPY)).toEqual(rowsOf(t.sqlite, 'deltas', fx.branchId))
  })

  it('refuses a fork missing a predicate for a table it filters', () => {
    const partial = { story_entries: 'all', deltas: 'all' } as const
    // @ts-expect-error a fork names a predicate for every table it filters
    const typed: BranchCopyArgs = { from: fx.branchId, to: COPY, mode: 'fork', where: partial }
    expect(() => branchCopyOps(t.db, typed)).toThrow(/reversal_journals/)

    for (const missing of FORK_FILTERED) {
      const where = Object.fromEntries(
        FORK_FILTERED.filter((name) => name !== missing).map((name) => [name, 'all']),
      )
      const untyped = {
        from: fx.branchId,
        to: COPY,
        mode: 'fork',
        where,
      } as unknown as BranchCopyArgs
      expect(() => branchCopyOps(t.db, untyped), missing).toThrow(missing)
    }
  })

  it('fails on the foreign key without a branches row and writes nothing', async () => {
    const sourceBefore = branchSnapshot(t.sqlite, fx.branchId)

    await expect(t.runInTransaction(duplicateOps())).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    )

    for (const table of [...DUPLICATE_TABLES, 'probe_captures', 'pipeline_runs'])
      expect(countOn(t.sqlite, table, COPY), table).toBe(0)
    expect(branchSnapshot(t.sqlite, fx.branchId)).toEqual(sourceBefore)
  })

  it('fails a second copy into the filled branch on its key and leaves both branches as they were', async () => {
    await t.runInTransaction([branchRowOp(COPY), ...duplicateOps()])
    const source = branchSnapshot(t.sqlite, fx.branchId)
    const copy = branchSnapshot(t.sqlite, COPY)

    await expect(t.runInTransaction(duplicateOps())).rejects.toThrow(/UNIQUE constraint failed/)

    expect(branchSnapshot(t.sqlite, fx.branchId)).toEqual(source)
    expect(branchSnapshot(t.sqlite, COPY)).toEqual(copy)
  })
})

const FAMILY_TABLES = [
  'entities_vec',
  'lore_vec',
  'happenings_vec',
  'threads_vec',
  'chapter_summaries_vec',
].flatMap((family) => [4, 8, 384].map((dim) => `${family}_${dim}`))

// The route's statements per family table: one self-insert.
const OPS_PER_FAMILY = 1

type VecRow = { pk: string; modelId: string; id: string; sourceHash: string; embedding: string }

/** Every family table's rows on the branch, keyed by table; a table holding none is left out. */
function vecRowsOf(sqlite: DatabaseSync, branchId: string): Record<string, VecRow[]> {
  const out: Record<string, VecRow[]> = {}
  for (const table of FAMILY_TABLES) {
    const rows = sqlite
      .prepare(
        `SELECT pk, model_id AS modelId, id, source_hash AS sourceHash, hex(embedding) AS embedding FROM ${table} WHERE branch_id = ? ORDER BY pk`,
      )
      .all(branchId) as VecRow[]
    if (rows.length > 0) out[table] = rows
  }
  return out
}

type PlantedVector = {
  pk: string
  modelId: string
  id: string
  sourceHash: string
  vector: readonly number[]
}

// Raw, so a row can carry the pre-widen key no writer emits any more.
function plantVector(sqlite: DatabaseSync, table: string, row: PlantedVector): void {
  sqlite
    .prepare(
      `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, 'br_a', ?, ?, ?, ?)`,
    )
    .run(row.pk, row.modelId, row.id, row.sourceHash, packFloat32(new Float32Array(row.vector)))
}

const AT = 1_800_000_000_000

const item = (id: string, name: string): NewEntity => ({
  id,
  branchId: 'br_a',
  kind: 'item',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: AT,
  updatedAt: AT,
})

/**
 * br_a's vector sources and vectors: two dim families under two models, one row keyed as before
 * the key widened, one whose entity a predicate leaves off the copy, one on a thread none copies.
 */
async function seedVectors(target: TestDb): Promise<{ chapterId: string }> {
  for (const dim of [4, 8]) for (const ddl of ensureVecTablesSql(dim)) target.sqlite.exec(ddl)
  await target.db
    .insert(entities)
    .values([item('ent_vec_kept', 'Brass key'), item('ent_vec_left', 'Tin cup')])
  await target.db.insert(lore).values({
    id: 'lore_vec_kept',
    branchId: 'br_a',
    title: 'The toll road',
    injectionMode: 'auto',
    createdAt: AT,
    updatedAt: AT,
  })
  await target.db.insert(threads).values({
    id: 'thr_vec_gone',
    branchId: 'br_a',
    title: 'The second seal',
    status: 'active',
    injectionMode: 'auto',
    createdAt: AT,
    updatedAt: AT,
  })
  const chapter = target.sqlite
    .prepare("SELECT id FROM chapters WHERE branch_id = 'br_a' ORDER BY id LIMIT 1")
    .get() as { id: string } | undefined
  if (!chapter) throw new Error('seedCopyFixture left br_a no chapter')
  const planted: [string, PlantedVector][] = [
    [
      'entities_vec_4',
      {
        pk: 'br_a:ent_vec_kept:model-x',
        modelId: 'model-x',
        id: 'ent_vec_kept',
        sourceHash: '0000000a',
        vector: [1, 0, 0, 0],
      },
    ],
    [
      'entities_vec_4',
      {
        pk: 'br_a:ent_vec_kept',
        modelId: 'model-y',
        id: 'ent_vec_kept',
        sourceHash: '0000000b',
        vector: [0, 1, 0, 0],
      },
    ],
    [
      'lore_vec_8',
      {
        pk: 'br_a:lore_vec_kept:model-y',
        modelId: 'model-y',
        id: 'lore_vec_kept',
        sourceHash: '0000000c',
        vector: [0, 0, 1, 0, 0, 0, 0, 0],
      },
    ],
    [
      'chapter_summaries_vec_4',
      {
        pk: `br_a:${chapter.id}:model-x`,
        modelId: 'model-x',
        id: chapter.id,
        sourceHash: '0000000d',
        vector: [0, 0, 1, 0],
      },
    ],
    [
      'entities_vec_8',
      {
        pk: 'br_a:ent_vec_left:model-x',
        modelId: 'model-x',
        id: 'ent_vec_left',
        sourceHash: '0000000e',
        vector: [0, 0, 0, 0, 1, 0, 0, 0],
      },
    ],
    [
      'threads_vec_4',
      {
        pk: 'br_a:thr_vec_gone:model-x',
        modelId: 'model-x',
        id: 'thr_vec_gone',
        sourceHash: '0000000f',
        vector: [0, 0, 0, 1],
      },
    ],
  ]
  for (const [table, row] of planted) plantVector(target.sqlite, table, row)
  return { chapterId: chapter.id }
}

describe('vecCopyOps', () => {
  it('builds the route’s statements for every family table and none for a shadow table', async () => {
    for (const dim of [4, 8]) for (const ddl of ensureVecTablesSql(dim)) t.sqlite.exec(ddl)
    // vec0's shadow tables sit beside each family in sqlite_master and reject DML.
    const shadows = t.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'entities_vec_4_*'",
      )
      .all()
    expect(shadows.length).toBeGreaterThan(0)

    const ops = await vecCopyOps(t.db, { from: 'br_a', to: 'br_c' })

    const targets = ops.flatMap((op) => /INSERT INTO (\w+)\s*\(\s*pk\b/.exec(op.sql)?.[1] ?? [])
    expect([...targets].sort()).toEqual([...FAMILY_TABLES].sort())
    expect(ops).toHaveLength(FAMILY_TABLES.length * OPS_PER_FAMILY)
    expect(
      ops.filter((op) => /_vec_\d+_(info|chunks|rowids|vector_chunks\d+)\b/.test(op.sql)),
    ).toEqual([])
  })

  it('copies each family’s vectors whose source the copy holds, keyed for br_c, in the table copy’s batch', async () => {
    const { chapterId } = await seedVectors(t)
    const before = vecRowsOf(t.sqlite, 'br_a')
    // The seed itself holds no vectors: every row below is one this test planted.
    expect(Object.keys(before).sort()).toEqual([
      'chapter_summaries_vec_4',
      'entities_vec_4',
      'entities_vec_8',
      'lore_vec_8',
      'threads_vec_4',
    ])

    const vectorOps = await vecCopyOps(t.db, { from: 'br_a', to: 'br_c' })
    await t.runInTransaction([
      branchRowOp(COPY),
      ...duplicateOps({
        entities: ne(entities.id, 'ent_vec_left'),
        // No thread copies, so threads_vec_4's source holds no br_c row.
        threads: sql`false`,
      }),
      ...vectorOps,
    ])

    const copied = (table: string, pk: string, newPk: string): VecRow => {
      const row = before[table]?.find((r) => r.pk === pk)
      if (!row) throw new Error(`br_a holds no ${table} row ${pk}`)
      return { ...row, pk: newPk }
    }
    expect(vecRowsOf(t.sqlite, 'br_c')).toEqual({
      chapter_summaries_vec_4: [
        copied('chapter_summaries_vec_4', `br_a:${chapterId}:model-x`, `br_c:${chapterId}:model-x`),
      ],
      entities_vec_4: [
        copied('entities_vec_4', 'br_a:ent_vec_kept:model-x', 'br_c:ent_vec_kept:model-x'),
        copied('entities_vec_4', 'br_a:ent_vec_kept', 'br_c:ent_vec_kept:model-y'),
      ],
      lore_vec_8: [
        copied('lore_vec_8', 'br_a:lore_vec_kept:model-y', 'br_c:lore_vec_kept:model-y'),
      ],
    })
    expect(countOn(t.sqlite, 'threads', 'br_c')).toBe(0)
    expect(vecRowsOf(t.sqlite, 'br_a')).toEqual(before)

    const nearest = (kind: VecTargetKind, dim: number, modelId: string, vector: number[]) => {
      const q = knnQuery(kind, dim, {
        branchId: 'br_c',
        modelId,
        k: 5,
        vector: packFloat32(new Float32Array(vector)),
      })
      return (
        t.sqlite.prepare(q.sql).all(...(q.params as SQLInputValue[])) as { id: string }[]
      ).map((row) => row.id)
    }
    expect(nearest('entity', 4, 'model-x', [1, 0, 0, 0])).toEqual(['ent_vec_kept'])
    expect(nearest('entity', 4, 'model-y', [0, 1, 0, 0])).toEqual(['ent_vec_kept'])
    expect(nearest('chapter', 4, 'model-x', [0, 0, 1, 0])).toEqual([chapterId])
    expect(nearest('entity', 8, 'model-x', [0, 0, 0, 0, 1, 0, 0, 0])).toEqual([])
  })
})
