import { and, asc, eq, isNull, ne, type SQL } from 'drizzle-orm'

import type { DbCtx, StoryEntry } from '../types'
import { storyEntries } from './story-entries.table'

export type OpenRegionRow = Readonly<{
  id: string
  kind: Exclude<StoryEntry['kind'], 'system'>
  position: number
  tokens: number
}>

/** data-model.md → Chapters / memory system: a branch's non-`system` entries no chapter closed. */
export function openRegionWhere(branchId: string): SQL {
  return and(
    eq(storyEntries.branchId, branchId),
    ne(storyEntries.kind, 'system'),
    isNull(storyEntries.chapterId),
  ) as SQL
}

/** Oldest first, with a row written before the column reading 0. */
export async function openRegionSeries(
  branchId: string,
  ctx: Pick<DbCtx, 'db'>,
): Promise<readonly OpenRegionRow[]> {
  const rows = await ctx.db
    .select({
      id: storyEntries.id,
      kind: storyEntries.kind,
      position: storyEntries.position,
      tokens: storyEntries.contentTokens,
    })
    .from(storyEntries)
    .where(openRegionWhere(branchId))
    .orderBy(asc(storyEntries.position), asc(storyEntries.createdAt))
  return rows.map((row) => ({
    ...row,
    kind: row.kind as OpenRegionRow['kind'],
    tokens: row.tokens ?? 0,
  }))
}
