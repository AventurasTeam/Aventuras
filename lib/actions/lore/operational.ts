import { and, eq } from 'drizzle-orm'

import { lore, type Lore } from '@/lib/db'
import { loreStore } from '@/lib/stores'

import type { DbCtx } from '../types'

type LoreOperationalFlags = Partial<{ embeddingStale: boolean }>

// Non-delta write seam for the compute-lifecycle column.
export async function setLoreOperationalFlags(
  branchId: string,
  id: string,
  flags: LoreOperationalFlags,
  ctx: DbCtx,
): Promise<void> {
  const set: Partial<Pick<Lore, 'embeddingStale'>> = {}
  if (flags.embeddingStale !== undefined) set.embeddingStale = flags.embeddingStale ? 1 : 0
  if (Object.keys(set).length === 0) return
  await ctx.runInTransaction([
    ctx.db
      .update(lore)
      .set(set)
      .where(and(eq(lore.branchId, branchId), eq(lore.id, id)))
      .toSQL(),
  ])
  loreStore.patch(branchId, { op: 'update', id, columns: set })
}
