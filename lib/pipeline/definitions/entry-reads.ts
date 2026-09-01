import { and, desc, eq, inArray, ne } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { NARRATIVE_KINDS } from '@/lib/piggyback'

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

// Bounded by the query rather than by a caller or a template, so neither the
// story's buffer knobs nor a pack can narrow it. Whichever phase asks, the
// classifier needs the action that caused a state change alongside the prose
// around it; which kinds those two rows are depends on when in the run it asks.
export async function readLastTurns(db: DbCtx['db'], branchId: string): Promise<StoryEntry[]> {
  const rows = await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position), desc(storyEntries.createdAt))
    .limit(LAST_TURNS)
  return rows.reverse()
}
