import { eq, sql } from 'drizzle-orm'

import type { SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'
import { generateId } from '@/lib/ids'

import type { DbCtx, MutationResult, PipelineAction } from '../types'
import { resolveByActionKind, resolveByTable } from './registry'

type Args = { action: PipelineAction; actionId: string; branchId: string; entryId?: string | null }

// MAX+1-within-branch as a subquery so the assignment is atomic inside the INSERT.
function nextLogPosition(branchId: string) {
  return sql<number>`(SELECT COALESCE(MAX(${deltas.logPosition}), 0) + 1 FROM ${deltas} WHERE ${deltas.branchId} = ${branchId})`
}

export async function applyDeltaAction(args: Args, ctx: DbCtx): Promise<MutationResult> {
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

  // Action layer owns the store mirror; the patcher branch-guards internally.
  if (outcome.patch) resolveByTable(outcome.targetTable)?.patcher?.(branchId, outcome.patch)

  // Read back by this delta's own id: a multi-delta action shares one actionId,
  // so an actionId lookup would return an arbitrary row's position.
  const [row] = await ctx.db
    .select({ lp: deltas.logPosition })
    .from(deltas)
    .where(eq(deltas.id, deltaId))
  return { status: 'ok', logPosition: row.lp }
}
