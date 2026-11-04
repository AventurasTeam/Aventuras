import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'

// One shared window for story-open hydrate, reader reload, and load-older
// paging, so the three read paths can't drift apart.
export const ENTRIES_WINDOW_SIZE = 50

/** Last {@link ENTRIES_WINDOW_SIZE} entries, ascending by position — the shape `entriesStore.hydrate` expects. */
export async function readRecentEntries(branchId: string, db: DbCtx['db']): Promise<StoryEntry[]> {
  const rows = (await db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
    .orderBy(desc(storyEntries.position))
    .limit(ENTRIES_WINDOW_SIZE)) as StoryEntry[]
  return rows.reverse()
}

/** The {@link ENTRIES_WINDOW_SIZE} entries just above `beforePosition`, ascending. */
export async function readEntriesBefore(
  branchId: string,
  beforePosition: number,
  db: DbCtx['db'],
): Promise<StoryEntry[]> {
  const rows = (await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), lt(storyEntries.position, beforePosition)))
    .orderBy(desc(storyEntries.position))
    .limit(ENTRIES_WINDOW_SIZE)) as StoryEntry[]
  return rows.reverse()
}

export async function readEntryPosition(
  branchId: string,
  entryId: string,
  db: DbCtx['db'],
): Promise<number | null> {
  const [row] = await db
    .select({ position: storyEntries.position })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, entryId)))
    .limit(1)
  return row?.position ?? null
}

/** `fromPosition <= position < beforePosition`, ascending. */
export async function readEntriesBetween(
  branchId: string,
  fromPosition: number,
  beforePosition: number,
  db: DbCtx['db'],
): Promise<StoryEntry[]> {
  return (await db
    .select()
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        gte(storyEntries.position, fromPosition),
        lt(storyEntries.position, beforePosition),
      ),
    )
    .orderBy(asc(storyEntries.position))) as StoryEntry[]
}
