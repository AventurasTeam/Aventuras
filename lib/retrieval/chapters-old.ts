import type { CharacterState } from '@/lib/db'

/**
 * retrieval.md → Scoring function, `chapters_old`: distance in chapters from the open chapter,
 * numbered one past the highest `sequence_number` a stamped entry carries. Derived per pass and
 * never stored, so a reversed or deleted chapter reads right on the next pass.
 */
export type ChapterAgeIndex = {
  /** A stamped entry's chapter sequence_number. */
  readonly sequenceOf: ReadonlyMap<string, number>
  /** One past the highest stamped sequence_number; 0 with no stamp. */
  readonly current: number
}

export const EMPTY_CHAPTER_AGES: ChapterAgeIndex = { sequenceOf: new Map(), current: 0 }

export function chapterAgeIndex(
  rows: readonly { sequence: number; entryId: string }[],
): ChapterAgeIndex {
  if (rows.length === 0) return EMPTY_CHAPTER_AGES
  const sequenceOf = new Map<string, number>()
  let highest = 0
  for (const { sequence, entryId } of rows) {
    sequenceOf.set(entryId, sequence)
    if (sequence > highest) highest = sequence
  }
  return { sequenceOf, current: highest + 1 }
}

/** Null for no anchor; 0 for an entry no closed chapter holds (open region or dangling). */
export function chaptersOldAt(
  entryId: string | null | undefined,
  index: ChapterAgeIndex,
): number | null {
  if (entryId === null || entryId === undefined) return null
  const sequence = index.sequenceOf.get(entryId)
  return sequence === undefined ? 0 : index.current - sequence
}

export type AwarenessAge = { learnedAtEntryId: string | null; decayResistance: number | null }

type Aged = { chaptersOld: number; pinSignal: number }

// The smaller age × (1 − pin) decides; ties to the larger pin, then the smaller age.
function decidesOver(a: Aged, b: Aged): boolean {
  const decayA = a.chaptersOld * (1 - a.pinSignal)
  const decayB = b.chaptersOld * (1 - b.pinSignal)
  if (decayA !== decayB) return decayA < decayB
  if (a.pinSignal !== b.pinSignal) return a.pinSignal > b.pinSignal
  return a.chaptersOld < b.chaptersOld
}

/**
 * The in-scene row minimising age × (1 − pin) decides, ties to the larger pin and then the smaller
 * age; its pair alone reproduces the candidate's recency factor for any λ. A row with no anchor
 * ages from the happening's own; with no row, nothing ages.
 */
export function happeningAge(
  rows: readonly AwarenessAge[],
  occurredAtEntryId: string | null,
  index: ChapterAgeIndex,
): { chaptersOld: number; pinSignal: number } {
  const fallback = chaptersOldAt(occurredAtEntryId, index) ?? 0
  let best: Aged | null = null
  for (const row of rows) {
    const aged = {
      chaptersOld: chaptersOldAt(row.learnedAtEntryId, index) ?? fallback,
      pinSignal: row.decayResistance ?? 0,
    }
    if (best === null || decidesOver(aged, best)) best = aged
  }
  return best ?? { chaptersOld: 0, pinSignal: 0 }
}

/** A character ages from where it was last seen; never seen, or not a character, reads 0. */
export function characterChaptersOld(
  lastSeenAt: CharacterState['lastSeenAt'] | undefined,
  index: ChapterAgeIndex,
): number {
  return chaptersOldAt(lastSeenAt?.entryId, index) ?? 0
}

/** A thread ages from where it resolved or failed; no ref reads 0. */
export function threadChaptersOld(
  resolvedAtEntryId: string | null,
  index: ChapterAgeIndex,
): number {
  return chaptersOldAt(resolvedAtEntryId, index) ?? 0
}
