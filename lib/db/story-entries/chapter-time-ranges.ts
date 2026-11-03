import { and, eq, gt, ne, sql } from 'drizzle-orm'

import type { DbCtx } from '../types'
import { storyEntries } from './story-entries.table'

export type ChapterTimeRange = { first: number; last: number }
/** By chapter id; `null` is the open region. A chapter with no time has no key. */
export type ChapterTimeRanges = ReadonlyMap<string | null, ChapterTimeRange>

const worldTime = sql<number>`json_extract(${storyEntries.metadata}, '$.worldTime')`

/** A range skips a world time of 0 (reader-composer.md) and a null: `> 0` drops both. */
export async function readChapterTimeRanges(
  branchId: string,
  db: DbCtx['db'],
): Promise<ChapterTimeRanges> {
  const rows = await db
    .select({
      chapterId: storyEntries.chapterId,
      first: sql<number>`min(${worldTime})`,
      last: sql<number>`max(${worldTime})`,
    })
    .from(storyEntries)
    .where(
      and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system'), gt(worldTime, 0)),
    )
    .groupBy(storyEntries.chapterId)
  return new Map(rows.map(({ chapterId, first, last }) => [chapterId, { first, last }]))
}
