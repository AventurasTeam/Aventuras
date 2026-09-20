import { and, eq, notInArray } from 'drizzle-orm'

import { branches, storyEntries, type DbCtx } from '@/lib/db'

/**
 * Whether any branch of the story holds a turn — a user action or an AI reply.
 * The wizard's opening is universal and a system notice transient; neither counts.
 */
export async function storyHasTurns(storyId: string, db: DbCtx['db']): Promise<boolean> {
  const rows = await db
    .select({ id: storyEntries.id })
    .from(storyEntries)
    .innerJoin(branches, eq(branches.id, storyEntries.branchId))
    // Denylist, so an entry kind added later counts as a turn until listed here.
    .where(and(eq(branches.storyId, storyId), notInArray(storyEntries.kind, ['opening', 'system'])))
    .limit(1)
  return rows.length > 0
}
