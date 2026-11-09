import { and, eq } from 'drizzle-orm'

import type { DbCtx } from '../types'
import { storyEntries } from './story-entries.table'

/** An entry's position on this branch, or null for an id the branch doesn't hold. */
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
