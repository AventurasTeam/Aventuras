import type { SqlOp } from '../types'

export type VecTargetKind = 'entity' | 'lore' | 'happening' | 'thread' | 'chapter'

export const VEC_FAMILIES: Record<VecTargetKind, string> = {
  entity: 'entities_vec',
  lore: 'lore_vec',
  happening: 'happenings_vec',
  thread: 'threads_vec',
  chapter: 'chapter_summaries_vec',
}

// vec0 creates shadow tables beside each virtual table (`_info`, `_chunks`,
// `_rowids`, `_vector_chunks00`), and those reject DML — so a name match has to
// be exact rather than a LIKE over `%_vec_%`.
const VEC_FAMILY_TABLE_RE = new RegExp(`^(?:${Object.values(VEC_FAMILIES).join('|')})_[1-9][0-9]*$`)

export function isVecFamilyTable(name: string): boolean {
  return VEC_FAMILY_TABLE_RE.test(name)
}

/**
 * Deletes every vector belonging to `branchIds`, across whichever dim families
 * currently exist. Discovery is by table name because nothing records which
 * families hold a given row's vectors, and after a kept or abandoned model swap
 * a branch legitimately has rows in more than one.
 *
 * vec0 tables are virtual, so they are absent from dbSchema and no Drizzle
 * cascade or DB-level FK reaches them — a caller deleting source rows must call
 * this or the vectors outlive them permanently.
 */
export function deleteBranchVecOps(
  tableNames: readonly string[],
  branchIds: readonly string[],
): SqlOp[] {
  if (branchIds.length === 0) return []
  const placeholders = branchIds.map(() => '?').join(', ')
  return tableNames.filter(isVecFamilyTable).map((table) => ({
    sql: `DELETE FROM ${table} WHERE branch_id IN (${placeholders})`,
    params: [...branchIds],
  }))
}

function assertValidDim(dim: number): void {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`Invalid vec0 dimension: ${dim}`)
  }
}

export function vecTableName(kind: VecTargetKind, dim: number): string {
  assertValidDim(dim)
  return `${VEC_FAMILIES[kind]}_${dim}`
}

// vec0 enforces its primary key globally across partitions, and swap staging
// can insert a NEW-model row NEXT TO an old-model row for the same source —
// so identity must carry branch, row, and model. Deletes always go by the real
// columns, never by pk string, which keeps pre-widen rows (branchId:id)
// forward-compatible.
export function vecRowPk(branchId: string, id: string, modelId: string): string {
  return `${branchId}:${id}:${modelId}`
}

// The five family tables a single dim writes into, across every kind.
export function dimFamilyTables(dim: number): string[] {
  return (Object.keys(VEC_FAMILIES) as VecTargetKind[]).map((kind) => vecTableName(kind, dim))
}

export function vecTableDim(name: string): number | null {
  if (!isVecFamilyTable(name)) return null
  const match = /_(\d+)$/.exec(name)
  return match === null ? null : Number(match[1])
}

/**
 * Which dim families actually hold vectors for `modelId` on these branches.
 * Discovered rather than derived: a provider's native dim is only learned from a
 * response, so where a story's vectors LIVE is the one answer available offline —
 * and it is what a relabel has to compare against, since relabel rewrites the
 * recorded model without moving a single row between families.
 */
export async function findVecDims(
  tableNames: readonly string[],
  branchIds: readonly string[],
  modelId: string,
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>,
): Promise<number[]> {
  if (branchIds.length === 0) return []
  const placeholders = branchIds.map(() => '?').join(', ')
  const dims = new Set<number>()
  for (const table of tableNames.filter(isVecFamilyTable)) {
    const dim = vecTableDim(table)
    if (dim === null) continue
    const rows = await queryAll(
      `SELECT 1 FROM ${table} WHERE branch_id IN (${placeholders}) AND model_id = ? LIMIT 1`,
      [...branchIds, modelId],
    )
    if (rows.length > 0) dims.add(dim)
  }
  return [...dims].sort((a, b) => a - b)
}

export function familyTablesFor(kind: VecTargetKind, tableNames: readonly string[]): string[] {
  const prefix = `${VEC_FAMILIES[kind]}_`
  return tableNames.filter((name) => isVecFamilyTable(name) && name.startsWith(prefix))
}

// Model-scoped (vs deleteBranchVecOps's all-model sweep) because a swap's
// phase-2/cancel must remove exactly one model's rows without touching a
// coexisting old- or new-model row for the same branch.
export function deleteBranchModelVecOps(
  tableNames: readonly string[],
  branchIds: readonly string[],
  modelId: string,
): SqlOp[] {
  if (branchIds.length === 0) return []
  const placeholders = branchIds.map(() => '?').join(', ')
  return tableNames.filter(isVecFamilyTable).map((table) => ({
    sql: `DELETE FROM ${table} WHERE branch_id IN (${placeholders}) AND model_id = ?`,
    params: [...branchIds, modelId],
  }))
}

export function ensureVecTablesSql(dim: number): string[] {
  assertValidDim(dim)
  return (Object.keys(VEC_FAMILIES) as VecTargetKind[]).map(
    (kind) => `CREATE VIRTUAL TABLE IF NOT EXISTS ${vecTableName(kind, dim)} USING vec0(
	pk text primary key,
	branch_id text partition key,
	model_id text,
	id text,
	+source_hash text,
	embedding float[${dim}]
);`,
  )
}

// vec0 DDL can't run inside the atomic ops-batch RPC (one serialized BEGIN..COMMIT
// per electron/db/service.ts transaction()); lazily-created dim families go through
// this raw exec seam instead.
export async function ensureVecTables(
  dim: number,
  exec: (sql: string) => Promise<void>,
): Promise<void> {
  for (const sql of ensureVecTablesSql(dim)) {
    await exec(sql)
  }
}
