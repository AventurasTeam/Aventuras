import { and, eq } from 'drizzle-orm'

import { entities, type Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { checkParentChain, PARENT_CHAIN_BROKEN, PARENT_CYCLE, parentOfLocations } from '@/lib/world'

import type { DbCtx } from '../types'

type PlaceRow = Pick<Entity, 'id' | 'kind' | 'state' | 'status' | 'injectionMode'>

/** The branch's places, as the pre-commit walk reads them. */
export async function branchPlaces(ctx: DbCtx, branchId: string): Promise<PlaceRow[]> {
  return ctx.db
    .select({
      id: entities.id,
      kind: entities.kind,
      state: entities.state,
      status: entities.status,
      injectionMode: entities.injectionMode,
    })
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.kind, 'location')))
}

/** data-model.md → LocationState: the pre-commit walk under `parentId`, a cap hit logged. */
export function parentChainRefusal(
  branchId: string,
  id: string,
  parentId: string,
  places: readonly PlaceRow[],
): typeof PARENT_CYCLE | typeof PARENT_CHAIN_BROKEN | null {
  const check = checkParentChain(id, parentId, parentOfLocations(places))
  if (check === 'cycle') return PARENT_CYCLE
  if (check === 'cap-hit') {
    logger.error('action_layer.parent_chain_cap_hit', { branchId, id, parentId })
    return PARENT_CHAIN_BROKEN
  }
  return null
}
