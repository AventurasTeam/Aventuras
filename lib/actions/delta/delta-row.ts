import { sql } from 'drizzle-orm'

import type { SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'

import type { DbCtx, DeltaSource } from '../types'
import type { DeltaOp } from './registry'

// MAX+1-within-branch as a subquery so the assignment is atomic inside the INSERT.
function nextLogPosition(branchId: string) {
  return sql<number>`(SELECT COALESCE(MAX(${deltas.logPosition}), 0) + 1 FROM ${deltas} WHERE ${deltas.branchId} = ${branchId})`
}

export type DeltaRowTarget = {
  targetTable: string
  targetId: string
  op: DeltaOp
  undoPayload: Record<string, unknown> | null
}

export type DeltaRowArgs = {
  deltaId: string
  branchId: string
  entryId: string | null
  actionId: string
  source: DeltaSource
  target: DeltaRowTarget
}

// The one place a forward delta row is shaped, so the log-position rule has a single
// home for callers that cannot dispatch through applyDeltaAction.
export function deltaRowOp(
  ctx: DbCtx,
  { deltaId, branchId, entryId, actionId, source, target }: DeltaRowArgs,
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
      targetTable: target.targetTable,
      targetId: target.targetId,
      op: target.op,
      undoPayload: target.undoPayload,
      encodingVersion: 1,
      createdAt: Date.now(),
    })
    .toSQL()
}
