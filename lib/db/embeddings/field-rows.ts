import type { EmbeddedFieldRow } from './stale'
import type { VecTargetKind } from './vec-tables'

// Canon: retrieval.md → What gets embedded per type. Order inside `fields`
// is the composite order and part of the source_hash — do not reorder.
const KIND_SOURCES: Record<VecTargetKind, { table: string; fields: [string, string] }> = {
  entity: { table: 'entities', fields: ['name', 'description'] },
  lore: { table: 'lore', fields: ['title', 'body'] },
  happening: { table: 'happenings', fields: ['title', 'description'] },
  thread: { table: 'threads', fields: ['title', 'description'] },
  chapter: { table: 'chapters', fields: ['summary', 'theme'] },
}

export type RowQuery = { sql: string; params: unknown[] }

export function embeddedRowQuery(kind: VecTargetKind): RowQuery {
  const { table, fields } = KIND_SOURCES[kind]
  return { sql: `SELECT id, branch_id, ${fields[0]}, ${fields[1]} FROM ${table}`, params: [] }
}

export function staleRowsQuery(kind: VecTargetKind, branchIds: readonly string[]): RowQuery {
  const base = embeddedRowQuery(kind)
  const placeholders = branchIds.map(() => '?').join(', ')
  return {
    sql: `${base.sql} WHERE embedding_stale = 1 AND branch_id IN (${placeholders})`,
    params: [...branchIds],
  }
}

export function branchRowsQuery(kind: VecTargetKind, branchIds: readonly string[]): RowQuery {
  const base = embeddedRowQuery(kind)
  const placeholders = branchIds.map(() => '?').join(', ')
  return { sql: `${base.sql} WHERE branch_id IN (${placeholders})`, params: [...branchIds] }
}

export function toEmbeddedFieldRow(kind: VecTargetKind, raw: readonly unknown[]): EmbeddedFieldRow {
  const [id, branchId, a, b] = raw as [string, string, string | null, string | null]
  return { kind, id, branchId, fields: [a, b] }
}

export async function countStaleRows(
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>,
  branchIds: readonly string[],
): Promise<{ total: number; byKind: Record<VecTargetKind, number> }> {
  const kinds = Object.keys(KIND_SOURCES) as VecTargetKind[]
  const byKind = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<VecTargetKind, number>

  if (branchIds.length === 0) {
    return { total: 0, byKind }
  }

  const placeholders = branchIds.map(() => '?').join(', ')
  let total = 0
  for (const kind of kinds) {
    const { table } = KIND_SOURCES[kind]
    const rows = await queryAll(
      `SELECT count(*) FROM ${table} WHERE embedding_stale = 1 AND branch_id IN (${placeholders})`,
      [...branchIds],
    )
    const count = Number(rows[0]?.[0] ?? 0)
    byKind[kind] = count
    total += count
  }

  return { total, byKind }
}
