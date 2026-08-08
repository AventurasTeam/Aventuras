import type { SqlOp } from '../types'
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

// Canon: retrieval.md → What gets embedded per type. Order inside `fields`
// is the composite order and part of the source_hash — do not reorder.
export const KIND_FIELDS: Record<VecTargetKind, [string, string]> = {
  entity: ['name', 'description'],
  lore: ['title', 'body'],
  happening: ['title', 'description'],
  thread: ['title', 'description'],
  chapter: ['summary', 'theme'],
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
  const [first, second] = KIND_FIELDS[row.kind]
  return {
    sql: `UPDATE ${SOURCE_TABLES[row.kind]} SET embedding_stale = 0
          WHERE id = ? AND branch_id = ? AND ${first} IS ? AND ${second} IS ?`,
    params: [row.id, row.branchId, row.fields[0] ?? null, row.fields[1] ?? null],
  }
}

export type StaleTargetRow = Pick<EmbeddedFieldRow, 'kind' | 'id' | 'branchId'>

// 400 ids + the branch param stays under the 999-variable floor of older SQLite
// builds, so a cancel on a large story can't blow the parameter limit.
const STALE_ID_CHUNK = 400

/**
 * Flags an explicit row set rather than whole tables, so a caller that knows
 * which rows it means (a cancel's not-yet-re-embedded tail) can't widen the
 * dirty set to rows whose vectors are current.
 */
export function flagEmbeddingStaleOps(rows: readonly StaleTargetRow[]): SqlOp[] {
  const groups = new Map<string, { kind: VecTargetKind; branchId: string; ids: string[] }>()
  for (const row of rows) {
    const key = `${row.kind}|${row.branchId}`
    const group = groups.get(key) ?? { kind: row.kind, branchId: row.branchId, ids: [] }
    group.ids.push(row.id)
    groups.set(key, group)
  }

  const ops: SqlOp[] = []
  for (const { kind, branchId, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += STALE_ID_CHUNK) {
      const chunk = ids.slice(i, i + STALE_ID_CHUNK)
      const placeholders = chunk.map(() => '?').join(', ')
      ops.push({
        sql: `UPDATE ${SOURCE_TABLES[kind]} SET embedding_stale = 1 WHERE branch_id = ? AND id IN (${placeholders})`,
        params: [branchId, ...chunk],
      })
    }
  }
  return ops
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
  return chunk(ids, STALE_ID_CHUNK).map((ids) => ({
    sql: `UPDATE ${SOURCE_TABLES[kind]} SET embedding_stale = ? WHERE branch_id = ? AND id IN (${ids
      .map(() => '?')
      .join(', ')})`,
    params: [stale, branchId, ...ids],
  }))
}

/**
 * Re-derives `embedding_stale` for `rows` by comparing each row's current content
 * hash against the vector `modelId` actually stored for it. A row with no stored
 * vector, or one whose content moved on, comes back stale.
 *
 * Set-based rather than per row: a cancel on a large story would otherwise issue
 * one query per row. The dim family is discovered instead of passed, because a
 * provider's native dim is not knowable here and the model id already identifies
 * the rows uniquely across families.
 */
export async function recomputeStaleOps(
  rows: readonly EmbeddedFieldRow[],
  modelId: string,
  tableNames: readonly string[],
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>,
): Promise<SqlOp[]> {
  const groups = new Map<
    string,
    { kind: VecTargetKind; branchId: string; rows: EmbeddedFieldRow[] }
  >()
  for (const row of rows) {
    const key = `${row.kind}|${row.branchId}`
    const group = groups.get(key) ?? { kind: row.kind, branchId: row.branchId, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }

  const ops: SqlOp[] = []
  for (const { kind, branchId, rows: groupRows } of groups.values()) {
    const stored = new Map<string, string>()
    for (const table of familyTablesFor(kind, tableNames)) {
      for (const ids of chunk(
        groupRows.map((row) => row.id),
        STALE_ID_CHUNK,
      )) {
        const found = await queryAll(
          `SELECT id, source_hash FROM ${table} WHERE branch_id = ? AND model_id = ? AND id IN (${ids
            .map(() => '?')
            .join(', ')})`,
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

    const stale: string[] = []
    const fresh: string[] = []
    for (const row of groupRows) {
      const current = sourceHash(compositeText(row.fields))
      ;(stored.get(row.id) === current ? fresh : stale).push(row.id)
    }
    ops.push(...setStaleOps(kind, branchId, stale, 1), ...setStaleOps(kind, branchId, fresh, 0))
  }
  return ops
}
