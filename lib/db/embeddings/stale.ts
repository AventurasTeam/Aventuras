import { getTableColumns } from 'drizzle-orm'

import { BIND_CHUNK } from '../bind-limit'
import { entities } from '../entities/entities.table'
import { happenings } from '../happenings/happenings.table'
import { lore } from '../lore/lore.table'
import { chapters } from '../story-entries/story-entries.table'
import { threads } from '../threads/threads.table'
import type { Chapter, Entity, Happening, Lore, SqlOp, Thread } from '../types'
import { compositeText, parseSourceHash, sourceHash } from './source-hash'
import { familyTablesFor, type VecTargetKind } from './vec-tables'

export type EmbeddedFieldRow = {
  kind: VecTargetKind
  id: string
  branchId: string
  fields: (string | null)[]
}

export const SOURCE_TABLES: Record<VecTargetKind, string> = {
  entity: 'entities',
  lore: 'lore',
  happening: 'happenings',
  thread: 'threads',
  chapter: 'chapters',
}

type KindRow = {
  entity: Entity
  lore: Lore
  happening: Happening
  thread: Thread
  chapter: Chapter
}

// Canon: retrieval.md → What gets embedded per type. Order is part of the
// source_hash — do not reorder. Elements are camelCase row keys typed per kind so
// a rename fails to compile; raw SQL splices KIND_COLUMNS, never these.
export const KIND_FIELDS: {
  [K in VecTargetKind]: readonly [keyof KindRow[K] & string, keyof KindRow[K] & string]
} = {
  entity: ['name', 'description'],
  lore: ['title', 'body'],
  happening: ['title', 'description'],
  thread: ['title', 'description'],
  chapter: ['summary', 'theme'],
}

const KIND_TABLES = {
  entity: entities,
  lore,
  happening: happenings,
  thread: threads,
  chapter: chapters,
}

/**
 * The SQL name of one of `KIND_FIELDS`' row keys, read off the Drizzle column so
 * the two spellings cannot drift. Exported for the test that pins the mapping
 * against a multi-word column, which no embedded field is yet.
 */
export function sqlColumnFor(kind: VecTargetKind, field: string): string {
  const columns: Record<string, { name: string } | undefined> = getTableColumns(KIND_TABLES[kind])
  const column = columns[field]
  if (!column) throw new Error(`${SOURCE_TABLES[kind]} has no column for field ${field}`)
  return column.name
}

function embeddedColumns(kind: VecTargetKind): readonly [string, string] {
  const [first, second] = KIND_FIELDS[kind]
  return [sqlColumnFor(kind, first), sqlColumnFor(kind, second)]
}

// KIND_FIELDS in SQL spelling, for the sites that splice a column name into raw
// SQL. Spelled per kind, not mapped, so a new kind is a compile error here too.
export const KIND_COLUMNS: Record<VecTargetKind, readonly [string, string]> = {
  entity: embeddedColumns('entity'),
  lore: embeddedColumns('lore'),
  happening: embeddedColumns('happening'),
  thread: embeddedColumns('thread'),
  chapter: embeddedColumns('chapter'),
}

// Derived from SOURCE_TABLES, so a new kind can't leave a table silently unguarded.
const EMBEDDED_FIELDS_BY_TABLE = new Map<string, readonly string[]>(
  Object.entries(SOURCE_TABLES).map(([kind, table]) => [table, KIND_FIELDS[kind as VecTargetKind]]),
)

export function embeddedFieldsForTable(table: string): readonly string[] | undefined {
  return EMBEDDED_FIELDS_BY_TABLE.get(table)
}

export function isEmbeddedSourceTable(table: string): boolean {
  return EMBEDDED_FIELDS_BY_TABLE.get(table) !== undefined
}

/**
 * Clears the flag for a row that was just embedded — but only if its embedded
 * columns still hold what the embed actually read.
 *
 * Optimistic concurrency rather than a blind clear: a writer that dirties the
 * row between loadStaleRows and this commit would otherwise have its flag wiped
 * by it, leaving new text, an old vector and a clean flag. Nothing re-derives
 * the flag outside an embedder swap, so that state is permanent, and it is a
 * lost update rather than writer negligence — the action-layer rule that every
 * embedded-field writer flips the flag cannot reach it.
 *
 * `IS`, not `=`: these columns are nullable and `NULL = NULL` is NULL, which
 * would fail the guard on every row with an empty description and leave it
 * dirty forever.
 */
export function clearEmbeddingStaleOp(row: EmbeddedFieldRow): SqlOp {
  const [first, second] = KIND_COLUMNS[row.kind]
  return {
    sql: `UPDATE ${SOURCE_TABLES[row.kind]} SET embedding_stale = 0
          WHERE id = ? AND branch_id = ? AND ${first} IS ? AND ${second} IS ?`,
    params: [row.id, row.branchId, row.fields[0] ?? null, row.fields[1] ?? null],
  }
}

export type StaleTargetRow = Pick<EmbeddedFieldRow, 'kind' | 'id' | 'branchId'>

/**
 * Flags an explicit row set rather than whole tables, so a caller that knows
 * which rows it means (a cancel's not-yet-re-embedded tail) can't widen the
 * dirty set to rows whose vectors are current.
 */
export function flagEmbeddingStaleOps(rows: readonly StaleTargetRow[]): SqlOp[] {
  const ops: SqlOp[] = []
  for (const { kind, branchId, rows: groupRows } of groupRowsByKindBranch(rows).values()) {
    for (const ids of chunk(
      groupRows.map((row) => row.id),
      BIND_CHUNK,
    )) {
      const placeholders = ids.map(() => '?').join(', ')
      ops.push({
        sql: `UPDATE ${SOURCE_TABLES[kind]} SET embedding_stale = 1 WHERE branch_id = ? AND id IN (${placeholders})`,
        params: [branchId, ...ids],
      })
    }
  }
  return ops
}

/**
 * Clear-side sibling of flagEmbeddingStaleOps, for revalidation's fresh rows.
 * Takes EmbeddedFieldRow so it can delegate to clearEmbeddingStaleOp's per-row
 * guard instead of clearing blind.
 */
export function clearEmbeddingStaleFlagsOps(rows: readonly EmbeddedFieldRow[]): SqlOp[] {
  return rows.map(clearEmbeddingStaleOp)
}

/**
 * Dirties every embeddable row on `branchIds`, whole-table rather than by the
 * explicit id set `flagEmbeddingStaleOps` takes: a relabel invalidates a story's
 * whole index at once, and enumerating ids would read every row to write one flag.
 */
export function flagBranchesEmbeddingStaleOps(branchIds: readonly string[]): SqlOp[] {
  if (branchIds.length === 0) return []
  const kinds = Object.keys(SOURCE_TABLES) as VecTargetKind[]
  return chunk(branchIds, BIND_CHUNK).flatMap((ids) => {
    const placeholders = ids.map(() => '?').join(', ')
    return kinds.map((kind) => ({
      sql: `UPDATE ${SOURCE_TABLES[kind]} SET embedding_stale = 1 WHERE branch_id IN (${placeholders})`,
      params: [...ids],
    }))
  })
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function setStaleOps(
  kind: VecTargetKind,
  branchId: string,
  ids: readonly string[],
  stale: 0 | 1,
): SqlOp[] {
  return chunk(ids, BIND_CHUNK).map((idChunk) => {
    const placeholders = idChunk.map(() => '?').join(', ')
    return {
      sql: `UPDATE ${SOURCE_TABLES[kind]} SET embedding_stale = ? WHERE branch_id = ? AND id IN (${placeholders})`,
      params: [stale, branchId, ...idChunk],
    }
  })
}

function groupRowsByKindBranch<T extends StaleTargetRow>(
  rows: readonly T[],
): Map<string, { kind: VecTargetKind; branchId: string; rows: T[] }> {
  const groups = new Map<string, { kind: VecTargetKind; branchId: string; rows: T[] }>()
  for (const row of rows) {
    const key = `${row.kind}|${row.branchId}`
    const group = groups.get(key) ?? { kind: row.kind, branchId: row.branchId, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return groups
}

/**
 * Splits `rows` by comparing each row's current content hash against the vector
 * `modelId` has stored for it; no stored vector, or content that moved on, comes
 * back in `staleRows`. Row order follows kind/branch group order, not `rows`'.
 *
 * `tableNames` MUST be narrowed to the dim family retrieval reads: a model id does
 * not identify rows uniquely across families and `stored` is last-family-wins, so
 * an unnarrowed list clears the flag on a row whose served vector is missing.
 */
export async function partitionByStoredVector(
  rows: readonly EmbeddedFieldRow[],
  modelId: string,
  tableNames: readonly string[],
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>,
): Promise<{ staleRows: EmbeddedFieldRow[]; freshRows: EmbeddedFieldRow[] }> {
  const staleRows: EmbeddedFieldRow[] = []
  const freshRows: EmbeddedFieldRow[] = []

  for (const { kind, branchId, rows: groupRows } of groupRowsByKindBranch(rows).values()) {
    const idChunks = chunk(
      groupRows.map((row) => row.id),
      BIND_CHUNK,
    )
    const stored = new Map<string, string>()
    for (const table of familyTablesFor(kind, tableNames)) {
      for (const ids of idChunks) {
        const placeholders = ids.map(() => '?').join(', ')
        const found = await queryAll(
          `SELECT id, source_hash FROM ${table} WHERE branch_id = ? AND model_id = ? AND id IN (${placeholders})`,
          [branchId, modelId, ...ids],
        )
        for (const [id, hash] of found as [string, unknown][]) {
          // An unparseable stored hash (legacy encoding, a driver handing back a
          // Buffer) is left absent, so the row reads stale rather than comparing
          // unequal forever.
          const parsed = parseSourceHash(hash)
          if (parsed !== null) stored.set(id, parsed)
        }
      }
    }

    for (const row of groupRows) {
      const current = sourceHash(compositeText(row.fields))
      ;(stored.get(row.id) === current ? freshRows : staleRows).push(row)
    }
  }

  return { staleRows, freshRows }
}

/**
 * Re-derives `embedding_stale` for `rows` via `partitionByStoredVector`. The dirty
 * half flags blind — erring dirty only costs a re-embed — while the fresh half goes
 * through `clearEmbeddingStaleFlagsOps`' per-row guard: an ungated user edit landing
 * mid-query would otherwise leave new text, an old vector and a clean flag, which
 * nothing re-derives outside a swap.
 */
export async function recomputeStaleOps(
  rows: readonly EmbeddedFieldRow[],
  modelId: string,
  tableNames: readonly string[],
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>,
): Promise<SqlOp[]> {
  const { staleRows, freshRows } = await partitionByStoredVector(
    rows,
    modelId,
    tableNames,
    queryAll,
  )
  // Grouped from staleRows directly, so an id is only ever read from the group that
  // owns it; safe because partitionByStoredVector returns in kind/branch group order.
  const ops: SqlOp[] = []
  for (const { kind, branchId, rows: groupRows } of groupRowsByKindBranch(staleRows).values()) {
    ops.push(
      ...setStaleOps(
        kind,
        branchId,
        groupRows.map((row) => row.id),
        1,
      ),
    )
  }
  ops.push(...clearEmbeddingStaleFlagsOps(freshRows))
  return ops
}
