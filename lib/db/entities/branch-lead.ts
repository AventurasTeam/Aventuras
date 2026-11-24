import { and, asc, eq } from 'drizzle-orm'

import { logger } from '@/lib/diagnostics'

import type { DbCtx, Entity } from '../types'
import { entities } from './entities.table'

/**
 * The branch's lead by the flag, whatever its status; null with none, or with two, which it logs
 * (data-model.md → The lead). For a caller with no store: the turn actions and the close.
 */
export async function readBranchLead(branchId: string, db: DbCtx['db']): Promise<Entity | null> {
  const flagged = await db
    .select()
    .from(entities)
    .where(
      and(eq(entities.branchId, branchId), eq(entities.isLead, 1), eq(entities.kind, 'character')),
    )
    .orderBy(asc(entities.id))
  if (flagged.length > 1)
    logger.error('action_layer.branch_lead_double', {
      branchId,
      ids: flagged.map((row) => row.id),
    })
  return flagged.length === 1 ? flagged[0] : null
}
