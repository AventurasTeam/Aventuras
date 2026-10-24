import { and, desc, eq, inArray } from 'drizzle-orm'

import { storyEntries, type StoryEntry } from '@/lib/db'
import { NARRATIVE_KINDS } from '@/lib/piggyback'
import { storyPlaceOf, type StoryPlace } from '@/lib/world'

import type { DbCtx } from '../types'
import { loadHeadTurn } from './head-turn'

// readSceneSource's pick (lib/pipeline's entry-reads.ts): a handler importing lib/pipeline closes
// an import cycle, so the action layer reads the scene source itself.
async function loadSceneSource(db: DbCtx['db'], branchId: string): Promise<StoryEntry | undefined> {
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

/** data-model.md → The story's place, read as a World Save reads it: the tail's and the scene's. */
export async function loadStoryPlace(branchId: string, ctx: DbCtx): Promise<StoryPlace> {
  const head = await loadHeadTurn(branchId, ctx)
  const sceneSource = await loadSceneSource(ctx.db, branchId)
  return storyPlaceOf({ tail: head?.tail, sceneSource })
}
