import {
  branchRowsQuery,
  clearSwapTargetOp,
  deleteBranchModelVecOps,
  isVecFamilyTable,
  setEmbeddingModelIdOp,
  setSwapTargetOp,
  toEmbeddedFieldRow,
  VEC_FAMILIES,
  type DbCtx,
  type EmbeddedFieldRow,
  type SqlOp,
  type VecTargetKind,
} from '@/lib/db'
import type { EmbedderConfig } from '@/lib/embedder'

export type SwapDeps = {
  db: DbCtx['db']
  runInTransaction: DbCtx['runInTransaction']
  /** Raw exec for vec0 DDL (same seam the wizard route threads into finishWizard). */
  exec: (sql: string) => Promise<void>
  /** Positional value-array rows (sqlite-proxy shape) — see field-rows.ts seam docs. */
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>
  /** `embedAndBuildVecOps` behind a seam so tests fault-inject per batch. */
  embedRows: (config: EmbedderConfig, rows: EmbeddedFieldRow[]) => Promise<SqlOp[]>
  listVecTables: () => Promise<string[]>
  onProgress: (done: number, total: number) => void
  isCancelRequested: () => boolean
  now: () => number
}

export type SwapParams = {
  storyId: string
  branchIds: readonly string[]
  currentModelId: string
  currentSwapTarget: string | null | undefined
  targetConfig: EmbedderConfig
}

export class SwapInProgressError extends Error {
  constructor() {
    super('A swap is already in progress for this story')
    this.name = 'SwapInProgressError'
  }
}

export class SwapNotInProgressError extends Error {
  constructor() {
    super('No swap is in progress to resume')
    this.name = 'SwapNotInProgressError'
  }
}

export class SwapStoryMissingError extends Error {
  constructor(storyId: string) {
    super(`Story ${storyId} is gone or has null settings; refusing to flip`)
    this.name = 'SwapStoryMissingError'
  }
}

const BATCH_SIZE = 16

// Mirrors SOURCE_TABLES in lib/db/embeddings/stale.ts, which the barrel doesn't
// re-export. The five embedded-source tables that carry embedding_stale.
const SWAP_SOURCE_TABLES = ['entities', 'lore', 'happenings', 'threads', 'chapters'] as const

export async function startSwap(deps: SwapDeps, p: SwapParams): Promise<'completed' | 'cancelled'> {
  if (p.currentSwapTarget != null) throw new SwapInProgressError()
  // The marker is committed in its own transaction BEFORE phase 1 — from here on
  // it is the crash-recovery source of truth for "swap in flight, expect NEW rows".
  await deps.runInTransaction([setSwapTargetOp(p.storyId, p.targetConfig.modelId, deps.now())])
  return runPhases(deps, p)
}

export async function resumeSwap(
  deps: SwapDeps,
  p: SwapParams,
): Promise<'completed' | 'cancelled'> {
  if (p.currentSwapTarget == null) throw new SwapNotInProgressError()
  // Marker already set by the original startSwap; resume must not re-set it.
  return runPhases(deps, p)
}

// Force a re-index onto the story's current model (target === current). The
// stage-then-flip flow and crash-recovery contract are identical to startSwap.
export async function reindexStory(
  deps: SwapDeps,
  p: SwapParams,
): Promise<'completed' | 'cancelled'> {
  return startSwap(deps, p)
}

async function runPhases(deps: SwapDeps, p: SwapParams): Promise<'completed' | 'cancelled'> {
  const targetModelId = p.targetConfig.modelId
  const sameModel = p.currentModelId === targetModelId

  const rows = await loadAllRows(deps, p.branchIds)
  // Same-model re-index: stagedIds can't tell a pre-existing vector from a freshly
  // re-embedded one (identical model_id), so don't skip anything — re-embed every
  // row. Upserts replace in place (same vector space), so this is idempotent and
  // partial progress is harmless.
  const staged = sameModel ? new Set<string>() : await stagedIds(deps, p.branchIds, targetModelId)
  const pending = rows.filter((r) => !staged.has(`${r.branchId}:${r.id}`))
  const total = rows.length
  let done = total - pending.length
  deps.onProgress(done, total)

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (deps.isCancelRequested()) {
      await cancelSwap(deps, { storyId: p.storyId, branchIds: p.branchIds, targetModelId })
      return 'cancelled'
    }
    const batch = pending.slice(i, i + BATCH_SIZE)
    // embedRows ensures the dim family exists (DDL outside the batch) and returns
    // upsert + stale-clear ops. Each batch is its own small txn, so a crash loses
    // at most one batch; old vectors stay intact until the phase-2 flip.
    const ops = await deps.embedRows(p.targetConfig, batch)
    await deps.runInTransaction(ops)
    done += batch.length
    deps.onProgress(done, total)
  }

  // A deleted story or one with null settings would let the flip's json_set no-op
  // silently: it would stage vectors, change nothing, and drop the marker, stranding
  // the swap. Refuse before committing phase 2. (Task 6 review hazards.)
  await assertStoryLive(deps, p.storyId)

  const tables = await deps.listVecTables()
  // Skip the old-model delete when re-indexing on the SAME model — those "old" rows
  // ARE the rows phase 1 just re-staged, so deleting them would wipe the re-index.
  const deleteOldOps = sameModel
    ? []
    : deleteBranchModelVecOps(tables, p.branchIds, p.currentModelId)
  await deps.runInTransaction([
    ...deleteOldOps,
    setEmbeddingModelIdOp(p.storyId, targetModelId, deps.now()),
    clearSwapTargetOp(p.storyId, deps.now()),
  ])
  return 'completed'
}

export async function cancelSwap(
  deps: SwapDeps,
  {
    storyId,
    branchIds,
    targetModelId,
  }: { storyId: string; branchIds: readonly string[]; targetModelId: string },
): Promise<void> {
  const tables = await deps.listVecTables()
  await deps.runInTransaction([
    ...deleteBranchModelVecOps(tables, branchIds, targetModelId),
    clearSwapTargetOp(storyId, deps.now()),
    ...reflagStaleOps(branchIds),
  ])
}

export async function relabelModel(
  deps: SwapDeps,
  {
    storyId,
    branchIds,
    oldModelId,
    newModelId,
  }: { storyId: string; branchIds: readonly string[]; oldModelId: string; newModelId: string },
): Promise<void> {
  if (newModelId === oldModelId) return

  const ops: SqlOp[] = []
  if (branchIds.length > 0) {
    const tables = (await deps.listVecTables()).filter(isVecFamilyTable)
    const ph = branchIds.map(() => '?').join(', ')
    // model_id is baked into the pk (vecRowPk) and is the KNN filter, so a plain
    // settings relabel would orphan every stored vector. Rewrite identity in SQL —
    // new pk + model_id, same source_hash + embedding — preserving "no recompute"
    // while keeping the story's recorded model id and its rows consistent.
    for (const table of tables) {
      ops.push(
        {
          sql: `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding)
        SELECT branch_id || ':' || id || ':' || ?, branch_id, ?, id, source_hash, embedding
        FROM ${table} WHERE branch_id IN (${ph}) AND model_id = ?`,
          params: [newModelId, newModelId, ...branchIds, oldModelId],
        },
        {
          sql: `DELETE FROM ${table} WHERE branch_id IN (${ph}) AND model_id = ?`,
          params: [...branchIds, oldModelId],
        },
      )
    }
  }
  ops.push(setEmbeddingModelIdOp(storyId, newModelId, deps.now()))
  await deps.runInTransaction(ops)
}

async function loadAllRows(
  deps: SwapDeps,
  branchIds: readonly string[],
): Promise<EmbeddedFieldRow[]> {
  const out: EmbeddedFieldRow[] = []
  for (const kind of Object.keys(VEC_FAMILIES) as VecTargetKind[]) {
    const q = branchRowsQuery(kind, branchIds)
    const rows = await deps.queryAll(q.sql, q.params)
    out.push(...rows.map((r) => toEmbeddedFieldRow(kind, r)))
  }
  return out
}

// Rows already staged under the target model — resume skips them.
async function stagedIds(
  deps: SwapDeps,
  branchIds: readonly string[],
  modelId: string,
): Promise<Set<string>> {
  const staged = new Set<string>()
  if (branchIds.length === 0) return staged

  // listVecTables can return vec0 shadow tables (`_info`, `_chunks`, …) that reject
  // or mis-serve these queries, so only real family tables are queried.
  const tables = (await deps.listVecTables()).filter(isVecFamilyTable)
  const ph = branchIds.map(() => '?').join(', ')
  for (const table of tables) {
    const rows = await deps.queryAll(
      `SELECT branch_id, id FROM ${table} WHERE branch_id IN (${ph}) AND model_id = ?`,
      [...branchIds, modelId],
    )
    for (const [branchId, id] of rows as [string, string][]) staged.add(`${branchId}:${id}`)
  }
  return staged
}

async function assertStoryLive(deps: SwapDeps, storyId: string): Promise<void> {
  const rows = await deps.queryAll('SELECT id, settings FROM stories WHERE id = ?', [storyId])
  const row = rows[0]
  if (row === undefined || row[1] == null) throw new SwapStoryMissingError(storyId)
}

function reflagStaleOps(branchIds: readonly string[]): SqlOp[] {
  if (branchIds.length === 0) return []
  const ph = branchIds.map(() => '?').join(', ')
  // Staging cleared embedding_stale for rows it re-embedded under the target model,
  // but their OLD-model vector may still be outdated. Re-flag so the next sync/drain
  // revalidates each by source_hash — cheap, and it re-embeds nothing when the old
  // vector still matches.
  return SWAP_SOURCE_TABLES.map((table) => ({
    sql: `UPDATE ${table} SET embedding_stale = 1 WHERE branch_id IN (${ph})`,
    params: [...branchIds],
  }))
}
