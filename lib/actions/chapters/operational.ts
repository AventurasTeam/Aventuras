import { and, eq } from 'drizzle-orm'

import { chapters, type Chapter } from '@/lib/db'
import { chaptersStore } from '@/lib/stores'

import type { DbCtx } from '../types'

// Non-delta write seam for the compute-lifecycle column (driver lands in M3).
export async function setChapterOperationalFlags(
  branchId: string,
  id: string,
  flags: Partial<{ embeddingStale: boolean }>,
  ctx: DbCtx,
): Promise<void> {
  const set: Partial<Pick<Chapter, 'embeddingStale'>> = {}
  if (flags.embeddingStale !== undefined) set.embeddingStale = flags.embeddingStale ? 1 : 0
  if (Object.keys(set).length === 0) return
  await ctx.runInTransaction([
    ctx.db
      .update(chapters)
      .set(set)
      .where(and(eq(chapters.branchId, branchId), eq(chapters.id, id)))
      .toSQL(),
  ])
  chaptersStore.patch(branchId, { op: 'update', id, columns: set })
}
