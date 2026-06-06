import { and, eq } from 'drizzle-orm'

import { threads, type Thread } from '@/lib/db'
import { threadsStore } from '@/lib/stores'

import type { DbCtx } from '../types'

type ThreadOperationalFlags = Partial<{ embeddingStale: boolean }>

// Non-delta write seam for the compute-lifecycle column.
export async function setThreadOperationalFlags(
  branchId: string,
  id: string,
  flags: ThreadOperationalFlags,
  ctx: DbCtx,
): Promise<void> {
  const set: Partial<Pick<Thread, 'embeddingStale'>> = {}
  if (flags.embeddingStale !== undefined) set.embeddingStale = flags.embeddingStale ? 1 : 0
  if (Object.keys(set).length === 0) return
  await ctx.runInTransaction([
    ctx.db
      .update(threads)
      .set(set)
      .where(and(eq(threads.branchId, branchId), eq(threads.id, id)))
      .toSQL(),
  ])
  threadsStore.patch(branchId, { op: 'update', id, columns: set })
}
