import { eq } from 'drizzle-orm'

import type { SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore, undoRedoStore } from '@/lib/stores'

import type { PipelineActionMap } from '../action-map'
import {
  isUserOriginatedSource,
  type DbCtx,
  type MutationResult,
  type PipelineAction,
} from '../types'
import { withBranchWriteShared } from './branch-write-lock'
import { capturedPatches } from './delete-cascade'
import { deltaRowOp } from './delta-row'
import { withKeyLocks } from './key-lock'
import { rowRefs } from './live-refs'
import { createdKey, resolveByActionKind, resolveByTable, type HandlerOutcome } from './registry'
import { entityCascadeKeys, rowLock, type RowLockKey } from './row-locks'

/** The runner's own refusals; a handler's code passes through beside them. */
export const DELTA_REJECTION = {
  reversalInProgress: 'reversal-in-progress',
  groupConflict: 'group-conflict',
} as const

type Args = { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null }
type OkOutcome = Extract<HandlerOutcome, { status: 'ok' }>

type ProductionKind = keyof PipelineActionMap
type LockKey<K extends ProductionKind> =
  | ((payload: PipelineActionMap[K]['payload']) => RowLockKey | readonly RowLockKey[])
  | null

const entityRow = rowLock('entities')
const relationships = rowLock('character_relationships')
// Involvements, awareness and happenings share one per-branch key (row-locks.ts).
const happeningLinks = rowLock('happening_involvements')
// C3: an entity delete cascades both link families, so it holds their writers off too.
const entityDelete = (p: { branchId: string; id: string }) => [
  entityRow(p),
  ...entityCascadeKeys(p),
]

// Handlers read before they commit, so a racing classifier/user write to one row must
// serialize. Keys come from rowLock, which reversals of the same tables lock by too.
const LOCK_KEY: { [K in ProductionKind]: LockKey<K> } = {
  createStoryEntry: null,
  updateStoryEntryMetadata: null,
  deleteStoryEntry: null,
  createEntity: null,
  updateEntity: entityRow,
  deleteEntity: entityDelete,
  updateEntityVisualState: entityRow,
  updateEntityInventory: entityRow,
  updateEntityStackables: entityRow,
  updateItemPosition: entityRow,
  updateEntityLocationTracking: entityRow,
  promoteStagedEntity: entityRow,
  appendEntityKeywords: entityRow,
  retireEntity: entityRow,
  upsertCharacterRelationship: relationships,
  deleteCharacterRelationship: relationships,
  createLore: null,
  updateLore: null,
  deleteLore: null,
  createThread: null,
  updateThread: null,
  deleteThread: null,
  createHappening: null,
  updateHappening: null,
  deleteHappening: happeningLinks,
  createHappeningInvolvement: (p) => happeningLinks(p.entry),
  updateHappeningInvolvement: happeningLinks,
  deleteHappeningInvolvement: happeningLinks,
  upsertHappeningAwareness: happeningLinks,
  deleteHappeningAwareness: happeningLinks,
  bumpAwarenessRetrieval: happeningLinks,
  createChapter: null,
  updateChapter: null,
  deleteChapter: null,
  createBranchEraFlip: null,
  updateBranchEraFlip: null,
  deleteBranchEraFlip: null,
  createEntryAsset: null,
  updateEntryAsset: null,
  deleteEntryAsset: null,
  createTranslation: null,
  updateTranslation: null,
  deleteTranslation: null,
}

function isProductionAction(
  a: PipelineAction,
): a is Extract<PipelineAction, { kind: ProductionKind }> {
  // False only for a TestPipelineActionMap kind.
  return Object.hasOwn(LOCK_KEY, a.kind)
}

function lockKeysOf<K extends ProductionKind>(
  kind: K,
  payload: PipelineActionMap[K]['payload'],
): readonly RowLockKey[] {
  const key: LockKey<K> = LOCK_KEY[kind]
  if (key === null) return []
  const keys = key(payload)
  return typeof keys === 'string' ? [keys] : keys
}

// The single and group paths both derive keys here, so they serialize against each other.
export function lockKeysFor(action: PipelineAction): readonly RowLockKey[] {
  return isProductionAction(action) ? lockKeysOf(action.kind, action.payload) : []
}

/** The rows a delete's cascade removed, read off its payload so they match what undo restores. */
function cascadedRows(outcome: OkOutcome) {
  if (outcome.op !== 'delete') return []
  return capturedPatches(resolveByTable(outcome.targetTable)?.cascade, outcome.undoPayload)
}

function emitOutcomePatches(branchId: string, outcome: OkOutcome): void {
  if (outcome.patch) resolveByTable(outcome.targetTable)?.patcher?.(branchId, outcome.patch)
  for (const child of cascadedRows(outcome))
    resolveByTable(child.table)?.patcher?.(branchId, child.patch)
}

// A user write can pass the reversal barrier just before it rises; the reversal settles these
// before it reads the log, or it would restore over the write once its lock frees.
const userWrites = new Set<Promise<unknown>>()

function trackUserWrite<T>(write: Promise<T>): Promise<T> {
  userWrites.add(write)
  write.then(
    () => userWrites.delete(write),
    () => userWrites.delete(write),
  )
  return write
}

/** Resolves once every user write dispatched so far has committed or been refused. */
export async function settleUserWrites(): Promise<void> {
  await Promise.allSettled([...userWrites])
}

export async function applyDeltaAction(args: Args, ctx: DbCtx): Promise<MutationResult> {
  const run = () => applyDeltaActionUnlocked(args, ctx)
  // The branch lock sits outside the row keys: a write queued behind a no-gate run holds no key
  // the run's own writes need (generation-pipeline.md → No-gate write phase).
  const write = withBranchWriteShared(args.branchId, args.actionId, () =>
    withKeyLocks(lockKeysFor(args.action), run),
  )
  return isUserOriginatedSource(args.action.source) ? trackUserWrite(write) : write
}

async function applyDeltaActionUnlocked(args: Args, ctx: DbCtx): Promise<MutationResult> {
  const { action, actionId, branchId } = args
  const entryId = args.entryId ?? null
  // The barrier (prose-reversal.ts) sets reversalInProgress before draining the in-flight
  // classifier burst, which must still commit — rejecting it here would burn a retry.
  if (isUserOriginatedSource(action.source) && generationStore.getTxState().reversalInProgress)
    return {
      status: 'rejected',
      code: DELTA_REJECTION.reversalInProgress,
      reason: 'prose reversal in progress',
    }

  const resolved = resolveByActionKind(action.kind)
  if (!resolved) return { status: 'rejected', reason: `no handler registered for ${action.kind}` }

  const outcome = await resolved.handler(action, branchId, ctx)
  if (outcome.status === 'rejected') return outcome

  const deltaId = generateId('delta')
  const ops: SqlOp[] = [
    deltaRowOp(ctx, {
      deltaId,
      branchId,
      entryId,
      actionId,
      source: action.source,
      target: outcome,
    }),
    ...outcome.ops,
  ]

  await ctx.runInTransaction(ops)

  // Any new delta-logged action invalidates redo (data-model.md → Entry
  // mutability & rollback). Cleared at this choke point so future forward
  // writers can't forget it; redo's own re-insert bypasses this function.
  undoRedoStore.clear()

  // Action layer owns the store mirror; the patcher branch-guards internally.
  emitOutcomePatches(branchId, outcome)

  // Read back by this delta's own id: a multi-delta action shares one actionId,
  // so an actionId lookup would return an arbitrary row's position.
  const [row] = await ctx.db
    .select({ lp: deltas.logPosition })
    .from(deltas)
    .where(eq(deltas.id, deltaId))
  // The transaction has committed and the store is patched, so the write stands
  // whatever the readback says. Reporting a failure here would tell the user a
  // durable edit was lost, and they would redo it into a second delta.
  if (!row) {
    logger.error('action_layer.delta_readback_miss', { deltaId, branchId, kind: action.kind })
    return { status: 'ok', logPosition: null }
  }
  return { status: 'ok', logPosition: row.lp }
}

export type DeltaGroupResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: string; code?: string }

type GroupArgs = { actionId: string; branchId: string; entryId?: string | null }

/**
 * Handlers read pre-group state, so a delete's cascade can't see the group's other writes: a
 * second delete of a row, or a second write to a cascaded one, logs it twice (undo then hits a
 * unique constraint forever); a write to a row the group deletes leaves an undo that refuses as
 * held; a link or translation to a deleted or cascaded row dangles.
 */
function groupConflict(outcomes: readonly OkOutcome[]): string | null {
  const cascaded = new Set<string>()
  const deleted = new Set<string>()
  for (const outcome of outcomes) {
    if (outcome.op === 'delete') {
      const key = createdKey(outcome.targetTable, outcome.targetId)
      if (deleted.has(key)) return `the group deletes ${key} twice`
      deleted.add(key)
    }
    for (const child of cascadedRows(outcome)) {
      const key = createdKey(child.table, child.patch.id)
      if (cascaded.has(key)) return `two deletes in the group cascade ${key}`
      cascaded.add(key)
    }
  }
  for (const outcome of outcomes) {
    const target = createdKey(outcome.targetTable, outcome.targetId)
    if (cascaded.has(target)) return `the group writes ${target}, which a delete in it cascades`
    if (outcome.op !== 'delete' && deleted.has(target))
      return `the group writes ${target}, which it deletes`
    const { patch } = outcome
    const written =
      patch?.op === 'create' ? patch.row : patch?.op === 'update' ? patch.columns : undefined
    for (const ref of written ? rowRefs(outcome.targetTable, written) : []) {
      const named = createdKey(ref.table, ref.id)
      // A link's ends are never cascaded, but a translation's target (a relationship) can be.
      if (deleted.has(named) || cascaded.has(named))
        return `the group links ${target} to ${named}, which it deletes or cascades`
    }
  }
  return null
}

/**
 * One actionId, one transaction: a rejection anywhere leaves nothing behind. Handlers read
 * pre-group state, so a group-created row shows only in `GroupScope`, a same-column double-write
 * on one row is rejected, and so is every `groupConflict` case (code `group-conflict`).
 */
export async function applyDeltaActionGroup(
  actions: readonly PipelineAction[],
  args: GroupArgs,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  const keys = actions.flatMap(lockKeysFor)
  const write = withBranchWriteShared(args.branchId, args.actionId, () =>
    withKeyLocks(keys, () => applyDeltaActionGroupUnlocked(actions, args, ctx)),
  )
  return actions.some((a) => isUserOriginatedSource(a.source)) ? trackUserWrite(write) : write
}

export type BuiltGroup<Code extends string = string> =
  | { status: 'ok'; actions: readonly PipelineAction[] }
  | { status: 'rejected'; reason: string; code: Code }

/**
 * applyDeltaActionGroup, but `build` runs under the branch lock's shared hold through the commit:
 * it reads every no-gate pass's writes so far, and none lands before commit. `build` must take no
 * lock, as the hold isn't reentrant. Refusals return as is, throws reject. Tracked as a user write.
 */
export function applyDeltaActionGroupBuilt(
  build: () => BuiltGroup,
  args: GroupArgs,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  const write = withBranchWriteShared(args.branchId, args.actionId, async () => {
    const built = build()
    if (built.status === 'rejected') return built
    const { actions } = built
    // Row keys come from the plan, so they follow the build, still inside the branch lock.
    return withKeyLocks(actions.flatMap(lockKeysFor), () =>
      applyDeltaActionGroupUnlocked(actions, args, ctx),
    )
  })
  return trackUserWrite(write)
}

async function applyDeltaActionGroupUnlocked(
  actions: readonly PipelineAction[],
  args: GroupArgs,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  const { actionId, branchId } = args
  const entryId = args.entryId ?? null

  type Prepared = { deltaId: string; source: PipelineAction['source']; outcome: OkOutcome }
  type Refusal = Extract<DeltaGroupResult, { status: 'rejected' }>
  const prepared: Prepared[] = []
  const pendingColumns = new Map<string, Set<string>>()
  const created = new Set<string>()

  // A refusal aborts the group; a 'noop' just commits nothing — a group can't half-fail on one.
  const prepare = async (action: PipelineAction): Promise<Refusal | 'noop' | null> => {
    if (isUserOriginatedSource(action.source) && generationStore.getTxState().reversalInProgress)
      return {
        status: 'rejected',
        code: DELTA_REJECTION.reversalInProgress,
        reason: 'prose reversal in progress',
      }

    const resolved = resolveByActionKind(action.kind)
    if (!resolved) return { status: 'rejected', reason: `no handler registered for ${action.kind}` }

    const outcome = await resolved.handler(action, branchId, ctx, { created })
    if (outcome.status === 'rejected')
      return outcome.code === 'noop'
        ? 'noop'
        : { status: 'rejected', reason: outcome.reason, code: outcome.code }

    const rowKey = createdKey(outcome.targetTable, outcome.targetId)
    const columns = outcome.patch?.op === 'update' ? Object.keys(outcome.patch.columns) : []
    const claimed = pendingColumns.get(rowKey) ?? new Set<string>()
    if (columns.some((column) => claimed.has(column)))
      return {
        status: 'rejected',
        reason: `group writes ${rowKey} twice on one column; every handler read pre-group state`,
      }
    for (const column of columns) claimed.add(column)
    pendingColumns.set(rowKey, claimed)

    prepared.push({ deltaId: generateId('delta'), source: action.source, outcome })
    if (outcome.op === 'create') created.add(rowKey)
    return null
  }

  const skipped: { action: PipelineAction; createdThen: number }[] = []
  for (const action of actions) {
    const refused = await prepare(action)
    if (refused === 'noop') skipped.push({ action, createdThen: created.size })
    else if (refused) return refused
  }
  // A link naming a row created later in the group no-ops on pass one: rerun it after all creates.
  // One rerun settles it: createOutcome mints relationship ids, so a group can't name its own.
  for (const { action, createdThen } of skipped) {
    if (created.size === createdThen) continue
    const refused = await prepare(action)
    if (refused && refused !== 'noop') return refused
  }

  if (prepared.length === 0) return { status: 'ok' }
  const conflict = groupConflict(prepared.map(({ outcome }) => outcome))
  if (conflict !== null)
    return { status: 'rejected', reason: conflict, code: DELTA_REJECTION.groupConflict }

  const ops: SqlOp[] = prepared.flatMap(({ deltaId, source, outcome }) => [
    deltaRowOp(ctx, { deltaId, branchId, entryId, actionId, source, target: outcome }),
    ...outcome.ops,
  ])

  await ctx.runInTransaction(ops)
  undoRedoStore.clear()
  for (const { outcome } of prepared) emitOutcomePatches(branchId, outcome)
  return { status: 'ok' }
}
