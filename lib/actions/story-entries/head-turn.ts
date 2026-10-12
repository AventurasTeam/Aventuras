import { and, desc, eq, inArray } from 'drizzle-orm'

import { storyEntries, type StoryEntry } from '@/lib/db'
import { resolveHeadTurn, type HeadTurn } from '@/lib/head-turn'
import { NARRATIVE_KINDS } from '@/lib/piggyback'

import type { DbCtx } from '../types'

/**
 * Three rows, not two: `resolveHeadTurn` owns the `system` skip, and the banner is a
 * singleton at the tail (system-entry.ts), so two narrative rows always survive it.
 */
export async function loadHeadTurn(
  branchId: string,
  ctx: DbCtx,
): Promise<HeadTurn<StoryEntry> | null> {
  const rows = (await ctx.db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
    .orderBy(desc(storyEntries.position))
    .limit(3)) as StoryEntry[]
  return resolveHeadTurn([...rows].reverse())
}

/** The latest narrative entry: the scene the next turn's prompt reads (readSceneSource's row). */
export async function loadSceneSource(
  branchId: string,
  ctx: DbCtx,
): Promise<StoryEntry | undefined> {
  const [row] = (await ctx.db
    .select()
    .from(storyEntries)
    .where(
      and(eq(storyEntries.branchId, branchId), inArray(storyEntries.kind, [...NARRATIVE_KINDS])),
    )
    .orderBy(desc(storyEntries.position), desc(storyEntries.createdAt))
    .limit(1)) as StoryEntry[]
  return row
}
