import { and, eq } from 'drizzle-orm'

import { entities, type Entity } from '@/lib/db'
import { entitiesStore } from '@/lib/stores'

import type { DbCtx } from '../types'

type OperationalFlags = Partial<{ embeddingStale: boolean; nameCollisionFlag: boolean }>

// Non-delta write seam for the compute-lifecycle columns. These are operational, not
// narrative: they bypass the delta log and patch the held-branch store directly. This is
// the seam only — the embedding/collision lifecycle (the consumer that flips these) is M3.
export async function setEntityOperationalFlags(
  branchId: string,
  id: string,
  flags: OperationalFlags,
  ctx: DbCtx,
): Promise<void> {
  const set: Partial<Pick<Entity, 'embeddingStale' | 'nameCollisionFlag'>> = {}
  if (flags.embeddingStale !== undefined) set.embeddingStale = flags.embeddingStale ? 1 : 0
  if (flags.nameCollisionFlag !== undefined) set.nameCollisionFlag = flags.nameCollisionFlag ? 1 : 0
  if (Object.keys(set).length === 0) return
  await ctx.runInTransaction([
    ctx.db
      .update(entities)
      .set(set)
      .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
      .toSQL(),
  ])
  entitiesStore.patch(branchId, { op: 'update', id, columns: set })
}
