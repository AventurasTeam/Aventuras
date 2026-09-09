import { and, desc, eq, inArray, ne } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { NARRATIVE_KINDS } from '@/lib/piggyback'
import { settingsCount } from '@/lib/settings-number'

const LAST_TURNS = 2

// Scene state is written by classification, so it lives on AI-authored rows; a
// user_action only inherits it forward. Reading the AI row directly keeps the
// scene independent of which kind happens to sit at the tail — and keeps the
// prompt and the ranker scoped to the same one.
export async function readSceneSource(
  db: DbCtx['db'],
  branchId: string,
): Promise<StoryEntry | undefined> {
  const [row] = await db
    .select()
    .from(storyEntries)
    .where(
      and(eq(storyEntries.branchId, branchId), inArray(storyEntries.kind, [...NARRATIVE_KINDS])),
    )
    .orderBy(desc(storyEntries.position), desc(storyEntries.createdAt))
    .limit(1)
  return row
}

// Bounded by the query, not the caller or a pack — nothing narrows it below the
// action-plus-reply pair the classifier needs (cadence.md → User-tunable knobs). A
// fractional or non-finite limit degrades to that floor instead of throwing or reading unbounded.
export async function readLastTurns(
  db: DbCtx['db'],
  branchId: string,
  limit: number = LAST_TURNS,
): Promise<StoryEntry[]> {
  const take = settingsCount(limit, LAST_TURNS)
  const rows = await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position), desc(storyEntries.createdAt))
    .limit(take)
  return rows.reverse()
}
