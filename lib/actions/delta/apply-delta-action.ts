import { eq, sql } from 'drizzle-orm'

import type { SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore, undoRedoStore } from '@/lib/stores'

import {
  isUserOriginatedSource,
  type DbCtx,
  type MutationResult,
  type PipelineAction,
} from '../types'
import { withKeyLock } from './key-lock'
import { resolveByActionKind, resolveByTable, type HandlerOutcome } from './registry'

type Args = { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null }

// Single and group commits must derive this identically or they stop serializing
// against each other.
function promoteStagedEntityLockKey(branchId: string, id: string): string {
  return `promoteStagedEntity:${branchId}:${id}`
}

// MAX+1-within-branch as a subquery so the assignment is atomic inside the INSERT.
function nextLogPosition(branchId: string) {
  return sql<number>`(SELECT COALESCE(MAX(${deltas.logPosition}), 0) + 1 FROM ${deltas} WHERE ${deltas.branchId} = ${branchId})`
}

type DeltaRowArgs = {
  deltaId: string
  branchId: string
  entryId: string | null
  actionId: string
  source: PipelineAction['source']
  outcome: Extract<HandlerOutcome, { status: 'ok' }>
}

function deltaRowOp(
  ctx: DbCtx,
  { deltaId, branchId, entryId, actionId, source, outcome }: DeltaRowArgs,
): SqlOp {
  return ctx.db
    .insert(deltas)
    .values({
      id: deltaId,
      branchId,
      entryId,
      actionId,
      logPosition: nextLogPosition(branchId),
      source,
      targetTable: outcome.targetTable,
      targetId: outcome.targetId,
      op: outcome.op,
      undoPayload: outcome.undoPayload,
      encodingVersion: 1,
      createdAt: Date.now(),
    })
    .toSQL()
}

export async function applyDeltaAction(args: Args, ctx: DbCtx): Promise<MutationResult> {
  const { action } = args
  // Defense in depth for the reversal barrier (prose-reversal.ts): rejecting a pipeline
  // write here would abort it mid-commit, wedging cadence since 'running' isn't delta-logged.
  if (isUserOriginatedSource(action.source) && generationStore.getTxState().reversalInProgress)
    return {
      status: 'rejected',
      code: 'reversal-in-progress',
      reason: 'prose reversal in progress',
    }
  // Opting in here covers promoteStagedEntity because its read-then-decide
  // (loadCurrent, then branch on status) lives inside its handler. An action
  // whose read happens before dispatch must take the lock itself.
  if (action.kind === 'promoteStagedEntity') {
    return withKeyLock(promoteStagedEntityLockKey(action.payload.branchId, action.payload.id), () =>
      applyDeltaActionUnlocked(args, ctx),
    )
  }
  return applyDeltaActionUnlocked(args, ctx)
}

async function applyDeltaActionUnlocked(args: Args, ctx: DbCtx): Promise<MutationResult> {
  const { action, actionId, branchId } = args
  const entryId = args.entryId ?? null

  const resolved = resolveByActionKind(action.kind)
  if (!resolved) return { status: 'rejected', reason: `no handler registered for ${action.kind}` }

  const outcome = await resolved.handler(action, branchId, ctx)
  if (outcome.status === 'rejected') return outcome

  const deltaId = generateId('delta')
  const ops: SqlOp[] = [
    deltaRowOp(ctx, { deltaId, branchId, entryId, actionId, source: action.source, outcome }),
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

function promoteLockKeys(actions: readonly PipelineAction[]): string[] {
  const keys = actions.flatMap((a) =>
    a.kind === 'promoteStagedEntity'
      ? [promoteStagedEntityLockKey(a.payload.branchId, a.payload.id)]
      : [],
  )
  // Sorted so two groups sharing a subset of keys acquire them in the same order.
  return [...new Set(keys)].sort()
}

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
  return withKeyLocks(promoteLockKeys(actions), () =>
    applyDeltaActionGroupUnlocked(actions, args, ctx),
  )
}

function withKeyLocks(
  keys: readonly string[],
  run: () => Promise<DeltaGroupResult>,
): Promise<DeltaGroupResult> {
  const [first, ...rest] = keys
  if (first === undefined) return run()
  return withKeyLock(first, () => withKeyLocks(rest, run))
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
    deltaRowOp(ctx, { deltaId, branchId, entryId, actionId, source, outcome }),
    ...outcome.ops,
  ])

  await ctx.runInTransaction(ops)
  undoRedoStore.clear()
  for (const { outcome } of prepared) {
    if (outcome.patch) resolveByTable(outcome.targetTable)?.patcher?.(branchId, outcome.patch)
  }
  return { status: 'ok' }
}
