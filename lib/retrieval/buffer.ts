import { and, count, desc, eq, isNull, ne } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'

export type BufferEntry = {
  id: string
  position: number
  // Derived, not a bare string: the filter below turns on the 'system' literal,
  // and a rename in the table would otherwise leak technical rows into both the
  // prompt buffer and Layer-A's same-name haystack with nothing failing.
  kind: StoryEntry['kind']
  chapterId: string | null
  content: string
}

export type BufferSettings = {
  fullChapterInBuffer: boolean
  partialChapterBuffer: number
  protectedBuffer: number
}

// Neither count carries .min() or .int() in storySettingsSchema. Fractions have
// to go before the count reaches a slice index, and the floors differ per knob:
// partialChapterBuffer 0 asks for no window at all, whereas protectedBuffer 0
// legitimately means "no spillover floor".
function toCount(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, Math.floor(value)) : floor
}

/**
 * cadence.md → Composition rule. Its "current chapter" is the open region:
 * entries whose `chapterId` is null (data-model.md → Chapters / memory system).
 */
export function composePromptBuffer<T extends BufferEntry>(
  entries: readonly T[],
  settings: BufferSettings,
): T[] {
  const ordered = entries.filter((e) => e.kind !== 'system').sort((a, b) => a.position - b.position)
  const take = promptBufferTake(ordered.filter((e) => e.chapterId === null).length, settings)

  // Front-indexed and clamped: a bare negative start is a tail of that size, so
  // a floor wider than the branch would return the last take - length entries
  // instead of everything.
  return ordered.slice(Math.max(0, ordered.length - take))
}

/**
 * How many entries the window holds, given the size of the open region.
 * Spillover is gated on that region running out, so protectedBuffer widens this
 * one window rather than reserving room alongside it — taking a tail of the
 * whole branch is what makes the two sources contiguous.
 */
export function promptBufferTake(openCount: number, settings: BufferSettings): number {
  const wanted = settings.fullChapterInBuffer
    ? openCount
    : toCount(settings.partialChapterBuffer, 1)
  return Math.max(toCount(settings.protectedBuffer, 0), Math.min(openCount, wanted))
}

/**
 * The prompt buffer straight from SQLite. Never from `entriesStore`: that store
 * holds the reader's window, which caps the buffer at whatever the reader
 * happens to have scrolled in, so the same story composes different prompts
 * across two turns of one session.
 */
export async function readPromptBuffer(
  db: DbCtx['db'],
  branchId: string,
  settings: BufferSettings,
): Promise<StoryEntry[]> {
  const narrative = and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system'))

  const [open] = await db
    .select({ openCount: count() })
    .from(storyEntries)
    .where(and(narrative, isNull(storyEntries.chapterId)))

  const take = promptBufferTake(open?.openCount ?? 0, settings)
  if (take === 0) return []

  const rows = (await db
    .select()
    .from(storyEntries)
    .where(narrative)
    .orderBy(desc(storyEntries.position))
    .limit(take)) as StoryEntry[]
  return rows.reverse()
}
