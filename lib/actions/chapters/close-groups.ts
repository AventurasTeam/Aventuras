import { and, desc, eq, inArray } from 'drizzle-orm'

import { deltas, type Delta } from '@/lib/db'

import type { DbCtx } from '../types'

// C1: a close writes no entries, so its deltas on these are the chapter row, its report and stamps.
export const DIVIDER_TABLES: ReadonlySet<string> = new Set(['chapters', 'story_entries'])

/** Every delta of the chapter's close groups (C13), newest first; [] when no close wrote it. */
export async function readChapterCloseGroups(
  branchId: string,
  chapterId: string,
  ctx: Pick<DbCtx, 'db'>,
): Promise<readonly Delta[]> {
  // The row's chapter_close groups: the close's and each re-run's.
  const groupIds = await ctx.db
    .selectDistinct({ actionId: deltas.actionId })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, 'chapters'),
        eq(deltas.targetId, chapterId),
        eq(deltas.source, 'chapter_close'),
      ),
    )
  if (groupIds.length === 0) return []
  return (await ctx.db
    .select()
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        inArray(
          deltas.actionId,
          groupIds.map((group) => group.actionId),
        ),
      ),
    )
    .orderBy(desc(deltas.logPosition))) as Delta[]
}
