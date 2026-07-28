import {
  branchRowsQuery,
  clearSwapTargetOp,
  deleteBranchModelVecOps,
  dimFamilyTables,
  familyTablesFor,
  findVecDims,
  flagEmbeddingStaleOps,
  isVecFamilyTable,
  recomputeStaleOps,
  setEmbeddingTargetOp,
  setSwapTargetOp,
  SOURCE_TABLES,
  toEmbeddedFieldRow,
  VEC_FAMILIES,
  type DbCtx,
  type EmbeddedFieldRow,
  type EmbeddingTarget,
  type SqlOp,
  type StaleTargetRow,
  type VecTargetKind,
} from '@/lib/db'
import type { EmbedderConfig } from '@/lib/embedder'

/**
 * Single-flight is a caller precondition, NOT enforced here. The
 * `currentSwapTarget` guard is only an advisory JS snapshot: two concurrent
 * engine calls for one story could both pass it and stage vectors under
 * different targets, orphaning the loser's rows (a storage leak — reads stay
 * correct because retrieval filters by model_id). Callers MUST serialize all
 * engine calls per story; `app-deps.runExclusive` owns that lock.
 */
export type SwapDeps = {
  runInTransaction: DbCtx['runInTransaction']
  /** Positional value-array rows (sqlite-proxy shape) — see field-rows.ts seam docs. */
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>
  /** `embedAndBuildVecOps` behind a seam so tests fault-inject per batch. */
  embedRows: (
    config: EmbedderConfig,
    rows: EmbeddedFieldRow[],
  ) => Promise<{ ops: SqlOp[]; dim: number | null }>
  listVecTables: () => Promise<string[]>
  onProgress: (done: number, total: number) => void
  isCancelRequested: () => boolean
  now: () => number
}

export type SwapParams = {
  storyId: string
  branchIds: readonly string[]
  currentModelId: string
  /** `null` = no swap in flight. */
  currentSwapTarget: string | null
  targetConfig: EmbedderConfig
}

export class SwapInProgressError extends Error {
  constructor(storyId: string, inFlightTarget: string) {
    super(`Story ${storyId} already has a swap in flight toward ${inFlightTarget}`)
    this.name = 'SwapInProgressError'
  }
}

export class SwapNotInProgressError extends Error {
  constructor(storyId: string) {
    super(`Story ${storyId} has no swap in flight to resume`)
    this.name = 'SwapNotInProgressError'
  }
}

export class SwapMarkerChangedError extends Error {
  constructor(storyId: string, expected: string, found: string | null) {
    super(
      `Story ${storyId} no longer records a swap toward ${expected} (found ${found ?? 'none'}); refusing to flip`,
    )
    this.name = 'SwapMarkerChangedError'
  }
}

/**
 * The target would be read at a different dim than the story's vectors are stored
 * at, so relabelling would orphan every one of them. Relabel exists to keep the
 * stored vectors readable; when it cannot, the honest operation is a re-index.
 */
export class RelabelDimMismatchError extends Error {
  readonly storedDims: readonly number[]
  readonly targetDim: number

  constructor(storyId: string, storedDims: readonly number[], targetDim: number) {
    super(
      `Story ${storyId} stores vectors at dim ${storedDims.join('/')}, but the relabel target reads at ${targetDim}`,
    )
    this.name = 'RelabelDimMismatchError'
    this.storedDims = storedDims
    this.targetDim = targetDim
  }
}

export class SwapStoryMissingError extends Error {
  constructor(storyId: string) {
    super(`Story ${storyId} is gone or has null settings; refusing to flip`)
    this.name = 'SwapStoryMissingError'
  }
}

const BATCH_SIZE = 16

// The resolved config already carries the backend and (for provider) the
// provider id, so the marker and the phase-2 flip read the target off it rather
// than taking a second, separately-threaded copy that could disagree.
function targetOf(config: EmbedderConfig): EmbeddingTarget {
  return config.backend === 'provider'
    ? { modelId: config.modelId, backend: 'provider', providerId: config.providerId }
    : { modelId: config.modelId, backend: 'local' }
}

export async function startSwap(deps: SwapDeps, p: SwapParams): Promise<'completed' | 'cancelled'> {
  if (p.currentSwapTarget != null) throw new SwapInProgressError(p.storyId, p.currentSwapTarget)
  // The marker is committed in its own transaction BEFORE phase 1 — from here on
  // it is the crash-recovery source of truth for "swap in flight, expect NEW rows".
  await deps.runInTransaction([setSwapTargetOp(p.storyId, targetOf(p.targetConfig), deps.now())])
  return runPhases(deps, p)
}

export async function resumeSwap(
  deps: SwapDeps,
  p: SwapParams,
): Promise<'completed' | 'cancelled'> {
  if (p.currentSwapTarget == null) throw new SwapNotInProgressError(p.storyId)
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

  // The dim phase 1 actually wrote at, which the served vector decides — not the
  // declared effectiveDim, which the service clamps to native.
  let stagedDim: number | null = null

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
      await cancelSwap(deps, {
        storyId: p.storyId,
        branchIds: p.branchIds,
        targetModelId,
        currentModelId: p.currentModelId,
        unprocessed: pending.slice(i),
      })
      return 'cancelled'
    }
    const batch = pending.slice(i, i + BATCH_SIZE)
    // embedRows ensures the dim family exists (DDL outside the batch) and returns
    // upsert + stale-clear ops. Each batch is its own small txn, so a crash loses
    // at most one batch. Cross-model, the old vectors sit untouched under their own
    // model id until phase 2; same-model, upserts replace them in place as they go.
    const { ops, dim } = await deps.embedRows(p.targetConfig, batch)
    stagedDim = dim ?? stagedDim
    await deps.runInTransaction(ops)
    done += batch.length
    deps.onProgress(done, total)
  }

  // A cancel issued during the final batch would otherwise land after the last
  // poll and flip the model anyway. This narrows the race to phase 2 itself.
  if (deps.isCancelRequested()) {
    await cancelSwap(deps, {
      storyId: p.storyId,
      branchIds: p.branchIds,
      targetModelId,
      currentModelId: p.currentModelId,
    })
    return 'cancelled'
  }

  // A deleted story or one with null settings would let the flip's json_set no-op
  // silently: it would stage vectors, change nothing, and drop the marker, stranding
  // the swap. Refuse before committing phase 2.
  await assertStoryLive(deps, p.storyId, targetModelId)

  const tables = await deps.listVecTables()
  // Under one model id the old rows and the staged ones are told apart only by dim
  // family, so the sweep has to spare the family phase 1 wrote into — swapping a
  // story between a provider copy and a local copy of the same model changes the
  // family without changing the id. Same-model staging skips nothing, so a null
  // staged dim means the story had no embeddable rows and there is nothing to
  // sweep either.
  let deleteOldOps: SqlOp[] = []
  if (!sameModel) {
    deleteOldOps = deleteBranchModelVecOps(tables, p.branchIds, p.currentModelId)
  } else if (stagedDim != null) {
    const spared = new Set(dimFamilyTables(stagedDim))
    deleteOldOps = deleteBranchModelVecOps(
      tables.filter((name) => !spared.has(name)),
      p.branchIds,
      p.currentModelId,
    )
  }
  await deps.runInTransaction([
    ...deleteOldOps,
    setEmbeddingTargetOp(p.storyId, targetOf(p.targetConfig), deps.now()),
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
    currentModelId,
    unprocessed,
  }: {
    storyId: string
    branchIds: readonly string[]
    targetModelId: string
    currentModelId: string
    /** Rows the live run had not re-embedded yet. Absent for a crash-recovered cancel. */
    unprocessed?: readonly StaleTargetRow[]
  },
): Promise<void> {
  const sameModel = targetModelId === currentModelId
  // Same-model re-index stages in place, so the "staged NEW rows" a cancel unwinds
  // ARE the story's only vectors — deleting them wipes the vector space rather than
  // restoring it. Mirrors the phase-2 old-model delete skip.
  const deleteStagedOps = sameModel
    ? []
    : deleteBranchModelVecOps(await deps.listVecTables(), branchIds, targetModelId)
  const staleOps = await cancelStaleOps(deps, {
    branchIds,
    targetModelId,
    currentModelId,
    sameModel,
    unprocessed,
  })
  await deps.runInTransaction([
    ...deleteStagedOps,
    clearSwapTargetOp(storyId, deps.now()),
    ...staleOps,
  ])
}

export async function relabelModel(
  deps: SwapDeps,
  {
    storyId,
    branchIds,
    oldModelId,
    target,
    targetReadDim,
  }: {
    storyId: string
    branchIds: readonly string[]
    oldModelId: string
    target: EmbeddingTarget
    /** Dim the target would be read at, or null when only an embed could answer. */
    targetReadDim?: number | null
  },
): Promise<void> {
  const newModelId = target.modelId

  // Rewriting model_id never moves a row between dim families, so a target read at
  // a different dim would leave every vector in a table nothing queries — silent
  // total loss on the one path that exists to avoid re-embedding. A story
  // truncating to effectiveDim on a provider, relabelled onto the local copy of
  // that model, is exactly that shape: stored at 512, read at the catalog's 384.
  if (targetReadDim != null && branchIds.length > 0) {
    const dims = await findVecDims(await deps.listVecTables(), branchIds, oldModelId, deps.queryAll)
    if (dims.length > 0 && (dims.length > 1 || dims[0] !== targetReadDim)) {
      throw new RelabelDimMismatchError(storyId, dims, targetReadDim)
    }
  }
  // Only the vec IDENTITY rewrite is model-id-scoped: `model_id` is baked into
  // the pk and the KNN filter, so an unchanged id leaves every vector where it
  // belongs. The settings write is not — a relabel can move a story between
  // backends or provider instances at the same model id.
  const ops: SqlOp[] = []
  if (newModelId !== oldModelId && branchIds.length > 0) {
    const tables = (await deps.listVecTables()).filter(isVecFamilyTable)
    const ph = branchIds.map(() => '?').join(', ')
    // Rewrite identity in place — new pk + model_id, same source_hash + embedding —
    // preserving "no recompute" while keeping the story and its rows consistent.
    for (const table of tables) {
      ops.push(
        // Relabel wins: clear any leftover newModelId rows first (e.g. staged
        // vectors from an abandoned swap toward the same id) so the INSERT can't
        // hit the vec0 pk constraint and roll the whole relabel back.
        {
          sql: `DELETE FROM ${table} WHERE branch_id IN (${ph}) AND model_id = ?`,
          params: [...branchIds, newModelId],
        },
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
  ops.push(setEmbeddingTargetOp(storyId, target, deps.now()))
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

/**
 * Rows already carrying a target-model vector. A cancel must read this BEFORE
 * its delete, which removes exactly this set.
 */
async function stagedRows(
  deps: SwapDeps,
  branchIds: readonly string[],
  modelId: string,
): Promise<StaleTargetRow[]> {
  const out: StaleTargetRow[] = []
  if (branchIds.length === 0) return out

  // familyTablesFor screens out the vec0 shadow tables (`_info`, `_chunks`, …)
  // that listVecTables returns, which reject or mis-serve these queries.
  const tables = await deps.listVecTables()
  const ph = branchIds.map(() => '?').join(', ')
  for (const kind of Object.keys(VEC_FAMILIES) as VecTargetKind[]) {
    for (const table of familyTablesFor(kind, tables)) {
      const rows = await deps.queryAll(
        `SELECT branch_id, id FROM ${table} WHERE branch_id IN (${ph}) AND model_id = ?`,
        [...branchIds, modelId],
      )
      for (const [branchId, id] of rows as [string, string][]) out.push({ kind, branchId, id })
    }
  }
  return out
}

// Rows already staged under the target model — resume skips them.
async function stagedIds(
  deps: SwapDeps,
  branchIds: readonly string[],
  modelId: string,
): Promise<Set<string>> {
  const rows = await stagedRows(deps, branchIds, modelId)
  return new Set(rows.map((row) => `${row.branchId}:${row.id}`))
}

/**
 * Phase-2 preflight. Beyond "the story still exists", this re-reads the marker:
 * `updateStorySettings` merges the whole settings blob in a separate transaction
 * (docs/implementation/triage.md), so a save that landed during phase 1 can carry
 * a pre-swap snapshot that the flip would then silently overwrite — vectors gone,
 * flags clean, settings naming the old model. Failing here instead leaves the
 * marker intact and the swap resumable.
 */
async function assertStoryLive(
  deps: SwapDeps,
  storyId: string,
  expectedTarget: string,
): Promise<void> {
  const rows = await deps.queryAll('SELECT id, settings FROM stories WHERE id = ?', [storyId])
  const row = rows[0]
  if (row === undefined || row[1] == null) throw new SwapStoryMissingError(storyId)
  const settings = JSON.parse(String(row[1])) as { embedding_swap_target?: string | null }
  const marker = settings.embedding_swap_target ?? null
  if (marker !== expectedTarget) throw new SwapMarkerChangedError(storyId, expectedTarget, marker)
}

/**
 * Which rows a cancel leaves dirty depends on the direction, because the flag
 * describes the vector the story is left ON.
 *
 * Same-model: rows re-embedded before the cancel are current, and the tail still
 * holds the embedding the user asked to replace — so only the tail is queued.
 * Cross-model: nothing was overwritten (staging wrote under the target's own
 * model id), so the old vectors the story reverts to are still there. Staging
 * cleared flags as it went, so the truth is re-derived from each row's stored
 * hash rather than assumed — blanket-flagging queued a full re-embed of rows
 * whose old vectors were current, at the user's expense.
 */
async function cancelStaleOps(
  deps: SwapDeps,
  {
    branchIds,
    targetModelId,
    currentModelId,
    sameModel,
    unprocessed,
  }: {
    branchIds: readonly string[]
    targetModelId: string
    currentModelId: string
    sameModel: boolean
    unprocessed?: readonly StaleTargetRow[]
  },
): Promise<SqlOp[]> {
  if (branchIds.length === 0) return []
  if (!sameModel) {
    const staged = await stagedIds(deps, branchIds, targetModelId)
    const touched = (await loadAllRows(deps, branchIds)).filter((row) =>
      staged.has(`${row.branchId}:${row.id}`),
    )
    return recomputeStaleOps(touched, currentModelId, await deps.listVecTables(), deps.queryAll)
  }
  // A same-model re-embed leaves nothing to recover the split from — same
  // model_id, and unchanged content hashes to the same source_hash — so a cancel
  // with no live run state (crash recovery) queues the whole story instead.
  if (unprocessed == null) return reflagAllOps(branchIds)
  return flagEmbeddingStaleOps(unprocessed)
}

function reflagAllOps(branchIds: readonly string[]): SqlOp[] {
  const ph = branchIds.map(() => '?').join(', ')
  return Object.values(SOURCE_TABLES).map((table) => ({
    sql: `UPDATE ${table} SET embedding_stale = 1 WHERE branch_id IN (${ph})`,
    params: [...branchIds],
  }))
}
