import { desc, eq } from 'drizzle-orm'

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
