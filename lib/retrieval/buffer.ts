import { and, count, desc, eq, isNull, ne } from 'drizzle-orm'

import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'

export type BufferSettings = {
  fullChapterInBuffer: boolean
  partialChapterBuffer: number
  protectedBuffer: number
}

// Hardening against settings that never went through storySettingsSchema.
// Fractions have to go before the count reaches a LIMIT, and the floors differ
// per knob: partialChapterBuffer 0 asks for no window at all, whereas
// protectedBuffer 0 legitimately means "no spillover floor".
function toCount(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, Math.floor(value)) : floor
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
 * cadence.md → Composition rule. Its "current chapter" is the open region:
 * entries whose `chapterId` is null (data-model.md → Chapters / memory system).
 *
 * Straight from SQLite, never `entriesStore`: that store starts at the last
 * ENTRIES_WINDOW_SIZE rows and only grows with scroll-up paging, so a window
 * wider than it would silently truncate and move with the reader.
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

  const rows = await db
    .select()
    .from(storyEntries)
    .where(narrative)
    .orderBy(desc(storyEntries.position))
    .limit(take)
  return rows.reverse()
}
