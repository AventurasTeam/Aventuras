export type VecTargetKind = 'entity' | 'lore' | 'happening' | 'thread' | 'chapter'

export const VEC_FAMILIES: Record<VecTargetKind, string> = {
  entity: 'entities_vec',
  lore: 'lore_vec',
  happening: 'happenings_vec',
  thread: 'threads_vec',
  chapter: 'chapter_summaries_vec',
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

// vec0 enforces its primary key globally across partitions (not scoped by the
// partition key), so a bare source-row id collides once a branch fork copies rows —
// the composite pk keeps identity unique while branch_id still partitions storage.
export function vecRowPk(branchId: string, id: string): string {
  return `${branchId}:${id}`
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
