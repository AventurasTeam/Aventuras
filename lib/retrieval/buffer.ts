import type { StoryEntry } from '@/lib/db'

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
  const openCount = ordered.filter((e) => e.chapterId === null).length

  const wanted = settings.fullChapterInBuffer
    ? openCount
    : toCount(settings.partialChapterBuffer, 1)

  // Spillover is gated on the open region running out, so the floor widens this
  // one window rather than reserving room alongside it. Taking a tail of the
  // whole branch is what makes the two sources contiguous.
  const take = Math.max(toCount(settings.protectedBuffer, 0), Math.min(openCount, wanted))

  // Front-indexed and clamped: a bare negative start is a tail of that size, so
  // a floor wider than the branch would return the last take - length entries
  // instead of everything.
  return ordered.slice(Math.max(0, ordered.length - take))
}
