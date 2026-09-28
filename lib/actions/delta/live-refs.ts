import { and, eq } from 'drizzle-orm'

import { entities, happenings } from '@/lib/db'

import type { DbCtx } from '../types'
import { createdKey, type GroupScope, type HandlerOutcome } from './registry'

export type LiveRef = { table: 'entities' | 'happenings'; id: string }

async function exists(ctx: DbCtx, branchId: string, ref: LiveRef): Promise<boolean> {
  if (ref.table === 'entities') {
    const [row] = await ctx.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.branchId, branchId), eq(entities.id, ref.id)))
    return row != null
  }
  const [row] = await ctx.db
    .select({ id: happenings.id })
    .from(happenings)
    .where(and(eq(happenings.branchId, branchId), eq(happenings.id, ref.id)))
  return row != null
}

/**
 * The FK-less link tables can't refuse a dead id, and a delete can land between a no-gate pass's
 * snapshot and its writes (cadence.md → Live-row guards). A row created earlier in the group counts.
 */
export async function missingRef(
  ctx: DbCtx,
  branchId: string,
  refs: readonly LiveRef[],
  group?: GroupScope,
): Promise<boolean> {
  for (const ref of refs) {
    if (group?.created.has(createdKey(ref.table, ref.id))) continue
    if (!(await exists(ctx, branchId, ref))) return true
  }
  return false
}

export const MISSING_REF: Extract<HandlerOutcome, { status: 'rejected' }> = {
  status: 'rejected',
  reason: 'the link names a row that no longer exists',
  code: 'noop',
}
