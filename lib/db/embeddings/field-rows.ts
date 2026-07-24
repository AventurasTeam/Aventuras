import { SOURCE_TABLES } from './stale'
import type { EmbeddedFieldRow } from './stale'
import type { VecTargetKind } from './vec-tables'

// Canon: retrieval.md → What gets embedded per type. Order inside `fields`
// is the composite order and part of the source_hash — do not reorder.
const KIND_FIELDS: Record<VecTargetKind, [string, string]> = {
  entity: ['name', 'description'],
  lore: ['title', 'body'],
  happening: ['title', 'description'],
  thread: ['title', 'description'],
  chapter: ['summary', 'theme'],
}

export type RowQuery = { sql: string; params: unknown[] }

// Module-private: a WHERE-less full scan is only a building block for the two
// filtered queries below; callers should never run it unfiltered against a DB.
function embeddedRowQuery(kind: VecTargetKind): RowQuery {
  const table = SOURCE_TABLES[kind]
  const [a, b] = KIND_FIELDS[kind]
  return { sql: `SELECT id, branch_id, ${a}, ${b} FROM ${table}`, params: [] }
}

export function staleRowsQuery(kind: VecTargetKind, branchIds: readonly string[]): RowQuery {
  const base = embeddedRowQuery(kind)
  // `IN ()` is a SQLite syntax error, so an empty branch set falls back to an
  // always-false predicate that still parses and yields zero rows.
  if (branchIds.length === 0) {
    return { sql: `${base.sql} WHERE 0`, params: [] }
  }
  const placeholders = branchIds.map(() => '?').join(', ')
  return {
    sql: `${base.sql} WHERE embedding_stale = 1 AND branch_id IN (${placeholders})`,
    params: [...branchIds],
  }
}

export function branchRowsQuery(kind: VecTargetKind, branchIds: readonly string[]): RowQuery {
  const base = embeddedRowQuery(kind)
  // `IN ()` is a SQLite syntax error, so an empty branch set falls back to an
  // always-false predicate that still parses and yields zero rows.
  if (branchIds.length === 0) {
    return { sql: `${base.sql} WHERE 0`, params: [] }
  }
  const placeholders = branchIds.map(() => '?').join(', ')
  return { sql: `${base.sql} WHERE branch_id IN (${placeholders})`, params: [...branchIds] }
}

/**
 * `raw` must be a positional value-array — the sqlite-proxy row shape (see
 * `lib/db/runtime/exec.ts`'s `listTableNames`), matching `embeddedRowQuery`'s
 * column order: id, branch_id, field[0], field[1]. A native/expo-sqlite caller
 * returning object rows must normalize to that shape first.
 */
export function toEmbeddedFieldRow(kind: VecTargetKind, raw: readonly unknown[]): EmbeddedFieldRow {
  const [id, branchId, a, b] = raw as [string, string, string | null, string | null]
  return { kind, id, branchId, fields: [a, b] }
}

export async function countStaleRows(
  /**
   * Row-array seam, not a drizzle handle: each returned row must be a
   * positional value-array (the sqlite-proxy shape — see
   * `lib/db/runtime/exec.ts`'s `listTableNames`), not a column-keyed object.
   * A native/expo-sqlite caller must normalize before handing this in.
   */
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>,
  branchIds: readonly string[],
): Promise<{ total: number; byKind: Record<VecTargetKind, number> }> {
  const kinds = Object.keys(KIND_FIELDS) as VecTargetKind[]
  const byKind = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<VecTargetKind, number>

  if (branchIds.length === 0) {
    return { total: 0, byKind }
  }

  let total = 0
  for (const kind of kinds) {
    // Wraps staleRowsQuery so the stale predicate can't drift between the
    // drain worker's row fetch and this count.
    const { sql, params } = staleRowsQuery(kind, branchIds)
    const rows = await queryAll(`SELECT count(*) FROM (${sql})`, params)
    const count = Number(rows[0]?.[0] ?? 0)
    byKind[kind] = count
    total += count
  }

  return { total, byKind }
}
