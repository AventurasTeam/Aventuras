import { eq, sql } from 'drizzle-orm'

import type { SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { undoRedoStore } from '@/lib/stores'

import type { DbCtx, MutationResult, PipelineAction } from '../types'
import { withKeyLock } from './key-lock'
import { resolveByActionKind, resolveByTable } from './registry'

type Args = { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null }

// MAX+1-within-branch as a subquery so the assignment is atomic inside the INSERT.
function nextLogPosition(branchId: string) {
  return sql<number>`(SELECT COALESCE(MAX(${deltas.logPosition}), 0) + 1 FROM ${deltas} WHERE ${deltas.branchId} = ${branchId})`
}

export async function applyDeltaAction(args: Args, ctx: DbCtx): Promise<MutationResult> {
  const { action } = args
  // Opting in here covers promoteStagedEntity because its read-then-decide
  // (loadCurrent, then branch on status) lives inside its handler. An action
  // whose read happens before dispatch must take the lock itself.
  if (action.kind === 'promoteStagedEntity') {
    return withKeyLock(`promoteStagedEntity:${action.payload.branchId}:${action.payload.id}`, () =>
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
    ctx.db
      .insert(deltas)
      .values({
        id: deltaId,
        branchId,
        entryId,
        actionId,
        logPosition: nextLogPosition(branchId),
        source: action.source,
        targetTable: outcome.targetTable,
        targetId: outcome.targetId,
        op: outcome.op,
        undoPayload: outcome.undoPayload,
        encodingVersion: 1,
        createdAt: Date.now(),
      })
      .toSQL(),
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
