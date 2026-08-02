export type BufferEntry = {
  id: string
  position: number
  kind: string
  chapterId: string | null
  content: string
}

export type BufferSettings = {
  fullChapterInBuffer: boolean
  partialChapterBuffer: number
  protectedBuffer: number
}

// Neither count carries .min() or .int() in storySettingsSchema, and slice()
// reads both -0 and -0.5 as "the whole branch" — clamp to an integer floor
// rather than trusting the bound.
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

  const open = ordered.filter((e) => e.chapterId === null)
  const closed = ordered.filter((e) => e.chapterId !== null)

  const fromOpen = settings.fullChapterInBuffer
    ? open
    : open.slice(-toCount(settings.partialChapterBuffer, 1))

  const shortfall = Math.max(0, toCount(settings.protectedBuffer, 0) - fromOpen.length)
  if (shortfall === 0) return fromOpen

  return [...closed.slice(-shortfall), ...fromOpen]
}
