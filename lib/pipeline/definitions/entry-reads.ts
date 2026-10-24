import { and, desc, eq, inArray, lt, ne, type SQL } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { NARRATIVE_KINDS } from '@/lib/piggyback'
import { settingsCount } from '@/lib/settings-number'
import { storyPlaceOf, type StoryPlace } from '@/lib/world'

const LAST_TURNS = 2

async function latestEntry(
  db: DbCtx['db'],
  branchId: string,
  filter: SQL,
  before?: number,
): Promise<StoryEntry | undefined> {
  const below = before === undefined ? undefined : lt(storyEntries.position, before)
  const [row] = await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), filter, below))
    .orderBy(desc(storyEntries.position), desc(storyEntries.createdAt))
    .limit(1)
  return row
}

const NARRATIVE = inArray(storyEntries.kind, [...NARRATIVE_KINDS])

// Scene state is written by classification, so it lives on AI-authored rows; a
// user_action only inherits it forward. Reading the AI row directly keeps the
// scene independent of which kind happens to sit at the tail — and keeps the
// prompt and the ranker scoped to the same one.
export function readSceneSource(
  db: DbCtx['db'],
  branchId: string,
): Promise<StoryEntry | undefined> {
  return latestEntry(db, branchId, NARRATIVE)
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

/**
 * data-model.md → The story's place: the narrative tail's location and the scene source's, read
 * below `before` when given, so a turn's reply already written leaves the place it found.
 */
export async function readStoryPlace(
  db: DbCtx['db'],
  branchId: string,
  before?: number,
): Promise<StoryPlace> {
  const tail = await latestEntry(db, branchId, ne(storyEntries.kind, 'system'), before)
  const sceneSource = await latestEntry(db, branchId, NARRATIVE, before)
  return storyPlaceOf({ tail, sceneSource })
}
