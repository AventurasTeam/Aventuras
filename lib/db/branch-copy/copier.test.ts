import type { DatabaseSync } from 'node:sqlite'

import { getTableColumns, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import {
  branchSnapshot,
  cloneBranch,
  seedCopyFixture,
  type CopyFixture,
  type TestDb,
} from '../__tests__/two-branch'
import { branches, deltas, entities, storyEntries } from '../schema'
import type { SqlOp } from '../types'
import { branchCopyOps, type BranchCopyArgs, type CopyPredicate } from './copier'
import { BRANCH_COPY_MANIFEST, type BranchCopyTableName } from './manifest'

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

    await t.runInTransaction([branchRowOp(COPY), ...duplicateOps()])

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
