import { rowQuery, type RowQuery } from '../types'
import { KIND_COLUMNS, KIND_FIELDS, SOURCE_TABLES } from './stale'
import type { EmbeddedFieldRow } from './stale'
import type { VecTargetKind } from './vec-tables'

// Module-private: a WHERE-less full scan is only a building block for the two
// filtered queries below; callers should never run it unfiltered against a DB.
function embeddedRowSql(kind: VecTargetKind): string {
  const table = SOURCE_TABLES[kind]
  // KIND_COLUMNS, not KIND_FIELDS: these are spliced as column names, and the
  // row keys only spell the same while every embedded field is single-word.
  const [a, b] = KIND_COLUMNS[kind]
  return `SELECT id, branch_id, ${a}, ${b} FROM ${table}`
}

// Both builders bind one variable per branch and neither chunks: a story's
// branch set only grows by an explicit user fork, never with its content.
export function staleRowsQuery(kind: VecTargetKind, branchIds: readonly string[]): RowQuery {
  const base = embeddedRowSql(kind)
  // `IN ()` is a SQLite syntax error, so an empty branch set falls back to an
  // always-false predicate that still parses and yields zero rows.
  if (branchIds.length === 0) {
    return rowQuery(`${base} WHERE 0`, [])
  }
  const placeholders = branchIds.map(() => '?').join(', ')
  return rowQuery(`${base} WHERE embedding_stale = 1 AND branch_id IN (${placeholders})`, [
    ...branchIds,
  ])
}

export function branchRowsQuery(kind: VecTargetKind, branchIds: readonly string[]): RowQuery {
  const base = embeddedRowSql(kind)
  if (branchIds.length === 0) {
    return rowQuery(`${base} WHERE 0`, [])
  }
  const placeholders = branchIds.map(() => '?').join(', ')
  return rowQuery(`${base} WHERE branch_id IN (${placeholders})`, [...branchIds])
}

/**
 * `raw` must be a positional value-array — the sqlite-proxy row shape (see
 * `lib/db/runtime/exec.ts`'s `listTableNames`), matching `embeddedRowSql`'s
 * column order: id, branch_id, field[0], field[1]. A native/expo-sqlite caller
 * returning object rows must normalize to that shape first.
 */
export function toEmbeddedFieldRow(kind: VecTargetKind, raw: readonly unknown[]): EmbeddedFieldRow {
  const [id, branchId, a, b] = raw as [string, string, string | null, string | null]
  return { kind, id, branchId, fields: [a, b] }
}

/** Row-array seam, not a drizzle handle — same positional shape as above. */
type QueryAll = (sql: string, params: unknown[]) => Promise<unknown[][]>

type RowCounts = { total: number; byKind: Record<VecTargetKind, number> }

// Counts through the same query builders the row fetches use, so a predicate
// can't drift between what a worker embeds and what the UI reports.
async function countRows(
  queryAll: QueryAll,
  branchIds: readonly string[],
  build: (kind: VecTargetKind, branchIds: readonly string[]) => RowQuery,
): Promise<RowCounts> {
  const kinds = Object.keys(KIND_FIELDS) as VecTargetKind[]
  const byKind = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<VecTargetKind, number>

  if (branchIds.length === 0) {
    return { total: 0, byKind }
  }

  let total = 0
  for (const kind of kinds) {
    const { sql, params } = build(kind, branchIds)
    const rows = await queryAll(`SELECT count(*) FROM (${sql})`, params)
    const count = Number(rows[0]?.[0] ?? 0)
    byKind[kind] = count
    total += count
  }

  return { total, byKind }
}

export function countStaleRows(
  queryAll: QueryAll,
  branchIds: readonly string[],
): Promise<RowCounts> {
  return countRows(queryAll, branchIds, staleRowsQuery)
}

/** Every embeddable row, stale or not — what a full re-index will re-embed. */
export function countEmbeddableRows(
  queryAll: QueryAll,
  branchIds: readonly string[],
): Promise<RowCounts> {
  return countRows(queryAll, branchIds, branchRowsQuery)
}
