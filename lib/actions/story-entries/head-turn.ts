import { desc, eq } from 'drizzle-orm'

import { storyEntries, type StoryEntry } from '@/lib/db'
import { resolveHeadTurn, type HeadTurn } from '@/lib/head-turn'

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
