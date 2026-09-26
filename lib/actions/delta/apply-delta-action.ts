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
import { withKeyLock, withKeyLocks } from './key-lock'
import { resolveByActionKind, resolveByTable, type HandlerOutcome } from './registry'
import { entityRowLockKey, relationshipsLockKey } from './row-locks'

type Args = { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null }

type ProductionKind = keyof PipelineActionMap
type LockKey<K extends ProductionKind> =
  | ((payload: PipelineActionMap[K]['payload']) => string)
  | null

const entityRow = (p: { branchId: string; id: string }) => entityRowLockKey(p.branchId, p.id)
const relationships = (p: { branchId: string }) => relationshipsLockKey(p.branchId)

// Handlers read before they commit, so a write the classifier and a user Save can both make
// to one row serializes: entities per row, relationships per branch.
const LOCK_KEY: { [K in ProductionKind]: LockKey<K> } = {
  createStoryEntry: null,
  updateStoryEntryMetadata: null,
  deleteStoryEntry: null,
  createEntity: null,
  updateEntity: entityRow,
  deleteEntity: entityRow,
  updateEntityVisualState: entityRow,
  updateEntityInventory: entityRow,
  updateEntityStackables: entityRow,
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
  deleteHappening: null,
  createHappeningInvolvement: null,
  updateHappeningInvolvement: null,
  deleteHappeningInvolvement: null,
  upsertHappeningAwareness: null,
  deleteHappeningAwareness: null,
  bumpAwarenessRetrieval: null,
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

function lockKeyOf<K extends ProductionKind>(
  kind: K,
  payload: PipelineActionMap[K]['payload'],
): string | null {
  const key: LockKey<K> = LOCK_KEY[kind]
  return key === null ? null : key(payload)
}

// The single and group paths both derive keys here, so they serialize against each other.
function lockKeyFor(action: PipelineAction): string | null {
  return isProductionAction(action) ? lockKeyOf(action.kind, action.payload) : null
}

export async function applyDeltaAction(args: Args, ctx: DbCtx): Promise<MutationResult> {
  const key = lockKeyFor(args.action)
  const run = () => applyDeltaActionUnlocked(args, ctx)
  return key === null ? run() : withKeyLock(key, run)
}

async function applyDeltaActionUnlocked(args: Args, ctx: DbCtx): Promise<MutationResult> {
  const { action, actionId, branchId } = args
  const entryId = args.entryId ?? null
  // The barrier (prose-reversal.ts) sets reversalInProgress before draining
  // the in-flight classifier, whose burst must still commit; rejecting a
  // pipeline write here would roll that burst back and burn a retry.
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
  if (outcome.patch) resolveByTable(outcome.targetTable)?.patcher?.(branchId, outcome.patch)

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
 * consequences bind callers: an action cannot depend on a row an earlier action in the
 * group creates, and two actions writing one row's same column would build payloads from
 * the same snapshot, so the later silently drops the earlier. The second is rejected
 * here rather than left to each caller to reason about.
 */
export async function applyDeltaActionGroup(
  actions: readonly PipelineAction[],
  args: GroupArgs,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  const keys = actions.map(lockKeyFor).filter((key) => key !== null)
  return withKeyLocks(keys, () => applyDeltaActionGroupUnlocked(actions, args, ctx))
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

  for (const action of actions) {
    if (isUserOriginatedSource(action.source) && generationStore.getTxState().reversalInProgress)
      return {
        status: 'rejected',
        code: 'reversal-in-progress',
        reason: 'prose reversal in progress',
      }

    const resolved = resolveByActionKind(action.kind)
    if (!resolved) return { status: 'rejected', reason: `no handler registered for ${action.kind}` }

    const outcome = await resolved.handler(action, branchId, ctx)
    if (outcome.status === 'rejected') {
      // A no-op contributes nothing to commit, and a group cannot half-fail on one.
      if (outcome.code === 'noop') continue
      return { status: 'rejected', reason: outcome.reason, code: outcome.code }
    }

    const rowKey = `${outcome.targetTable}:${outcome.targetId}`
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
  }

  if (prepared.length === 0) return { status: 'ok' }

  const ops: SqlOp[] = prepared.flatMap(({ deltaId, source, outcome }) => [
    deltaRowOp(ctx, { deltaId, branchId, entryId, actionId, source, target: outcome }),
    ...outcome.ops,
  ])

  await ctx.runInTransaction(ops)
  undoRedoStore.clear()
  for (const { outcome } of prepared) {
    if (outcome.patch) resolveByTable(outcome.targetTable)?.patcher?.(branchId, outcome.patch)
  }
  return { status: 'ok' }
}
