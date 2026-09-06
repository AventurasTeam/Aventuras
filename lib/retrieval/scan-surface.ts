import { and, desc, eq, ne } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'

import { warnOnDuplicatePositions } from './buffer'

// Hardening against settings that never went through storySettingsSchema, the
// same threat readPromptBuffer's toCount covers: a fractional or NaN limit
// reaches SQLite raw. One trailing entry is the floor the surface is defined on.
function toTake(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

export type ScanSurfaceInput = {
  /** This turn's action, already committed ahead of the run. */
  userAction: string
  /** The entries standing before it, oldest first. */
  trailing: readonly StoryEntry[]
}

/**
 * The haystack the keyword pathway matches against, deliberately independent of
 * the query stack so the lexical complement does not inherit the dense
 * pathway's inputs (docs/memory/retrieval.md → Keyword scan surface).
 *
 * `promptProse` so a keyword matches what the model was actually shown.
 */
export function buildScanText(input: ScanSurfaceInput): string {
  return [input.userAction.trim(), ...input.trailing.map((e) => promptProse(e))]
    .filter((s) => s !== '')
    .join('\n')
}

/**
 * The last `take` entries standing before this turn's action, oldest first.
 *
 * Its own read rather than a slice of `readPromptBuffer`: the scan surface is
 * defined independently of the prompt window, whose depth `protectedBuffer` and
 * `partialChapterBuffer` govern — with `protectedBuffer` at 0 that window can be
 * shorter than `scanEntries`, which would scan less than configured and report
 * nothing.
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
    .limit(toTake(take) + 1)
  warnOnDuplicatePositions(rows, branchId)
  // The action reaches the surface through `userAction`; leaving it here too
  // would weight this turn's own words twice against every keyword.
  const trailing = rows[0]?.kind === 'user_action' ? rows.slice(1) : rows
  return trailing.slice(0, toTake(take)).reverse()
}
