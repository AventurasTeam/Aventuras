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
import { deltaRowOp } from './delta-row'
import { withKeyLocks } from './key-lock'
import { createdKey, resolveByActionKind, resolveByTable, type HandlerOutcome } from './registry'
import { entityCascadeKeys, rowLock, type RowLockKey } from './row-locks'

type Args = { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null }

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

function emitOutcomePatches(
  branchId: string,
  outcome: Extract<HandlerOutcome, { status: 'ok' }>,
): void {
  if (outcome.patch) resolveByTable(outcome.targetTable)?.patcher?.(branchId, outcome.patch)
  for (const child of outcome.cascadePatches ?? [])
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
  const write = withKeyLocks(lockKeysFor(args.action), run)
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
      code: 'reversal-in-progress',
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
 * Commits several actions under one actionId as a SINGLE transaction, so a rejection
 * anywhere in the group leaves nothing behind. Sequential `applyDeltaAction` calls
 * cannot give that: each commits on its own, so a caller learns of a failure only once
 * the earlier writes are durable and the stores are patched.
 *
 * Handlers run before the transaction opens, so every one reads pre-group state. Two
 * consequences bind callers: an action cannot read a row an earlier action in the group
 * creates (its `GroupScope` only names it), and two actions writing one row's same column
 * would build payloads from the same snapshot, so the later silently drops the earlier. The
 * second is rejected here rather than left to each caller to reason about.
 *
 * A third: a group must not both delete a row and create or delete a link naming it. Creating
 * one races the same pre-group snapshot — the live-row guard would see the row still there, and
 * the delete's cascade would never learn of the link to sweep it. Deleting one duplicates the
 * cascade's own delete of that link, so the group logs it twice and undo tries to restore it
 * twice — a primary-key conflict.
 */
export async function applyDeltaActionGroup(
  actions: readonly PipelineAction[],
  args: GroupArgs,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  const keys = actions.flatMap(lockKeysFor)
  const write = withKeyLocks(keys, () => applyDeltaActionGroupUnlocked(actions, args, ctx))
  return actions.some((a) => isUserOriginatedSource(a.source)) ? trackUserWrite(write) : write
}

async function applyDeltaActionGroupUnlocked(
  actions: readonly PipelineAction[],
  args: GroupArgs,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  const { actionId, branchId } = args
  const entryId = args.entryId ?? null

  type Prepared = {
    deltaId: string
    source: PipelineAction['source']
    outcome: Extract<HandlerOutcome, { status: 'ok' }>
  }
  const prepared: Prepared[] = []
  const pendingColumns = new Map<string, Set<string>>()
  const created = new Set<string>()

  for (const action of actions) {
    if (isUserOriginatedSource(action.source) && generationStore.getTxState().reversalInProgress)
      return {
        status: 'rejected',
        code: 'reversal-in-progress',
        reason: 'prose reversal in progress',
      }

    const resolved = resolveByActionKind(action.kind)
    if (!resolved) return { status: 'rejected', reason: `no handler registered for ${action.kind}` }

    const outcome = await resolved.handler(action, branchId, ctx, { created })
    if (outcome.status === 'rejected') {
      // A no-op contributes nothing to commit, and a group cannot half-fail on one.
      if (outcome.code === 'noop') continue
      return { status: 'rejected', reason: outcome.reason, code: outcome.code }
    }

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
  }

  if (prepared.length === 0) return { status: 'ok' }

  const ops: SqlOp[] = prepared.flatMap(({ deltaId, source, outcome }) => [
    deltaRowOp(ctx, { deltaId, branchId, entryId, actionId, source, target: outcome }),
    ...outcome.ops,
  ])

  await ctx.runInTransaction(ops)
  undoRedoStore.clear()
  for (const { outcome } of prepared) emitOutcomePatches(branchId, outcome)
  return { status: 'ok' }
}
