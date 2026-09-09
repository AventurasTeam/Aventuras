import { and, desc, eq, ne } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'
import { settingsCount } from '@/lib/settings-number'

import { warnOnDuplicatePositions } from './buffer'

export type ScanSurfaceInput = {
  /** This turn's action, already committed ahead of the run. */
  userAction: string
  /** The entries standing before it, oldest first. */
  trailing: readonly StoryEntry[]
}

/**
 * The keyword pathway's haystack — independent of the query stack, and built from
 * `promptProse` so a keyword matches what the model was actually shown.
 * docs/memory/retrieval.md → Keyword scan surface.
 */
export function buildScanText(input: ScanSurfaceInput): string {
  return [input.userAction.trim(), ...input.trailing.map((e) => promptProse(e))]
    .filter((s) => s !== '')
    .join('\n')
}

/**
 * The last `take` entries standing before this turn's action, oldest first.
 *
 * Its own read, not a slice of `readPromptBuffer`: with `protectedBuffer` at 0 the
 * prompt window can be shorter than `scanEntries` and silently scan less than asked.
 */
export async function readScanEntries(
  db: DbCtx['db'],
  branchId: string,
  take: number,
): Promise<StoryEntry[]> {
  const rows = await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position), desc(storyEntries.createdAt))
    .limit(settingsCount(take, 1) + 1)
  warnOnDuplicatePositions(rows, branchId)
  // The action reaches the surface through `userAction`; leaving it here too
  // would weight this turn's own words twice against every keyword.
  const trailing = rows[0]?.kind === 'user_action' ? rows.slice(1) : rows
  return trailing.slice(0, settingsCount(take, 1)).reverse()
}
