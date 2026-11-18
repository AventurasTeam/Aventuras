import type { StoryEntry } from '@/lib/db'

import { canEndChapter } from './can-end-chapter'

/** A candidate row with the open region's running token total through it. */
export type CloseCandidate<R> = R & { tokensThrough: number }

/**
 * chapter-close.md → Phase 1: each row that may end a chapter where the running total sits from
 * half a threshold to one and a half, both inclusive, never the newest such row. `series` oldest
 * first, as openRegionSeries reads it; the result keeps that order, so its last is the latest.
 */
export function closeCandidates<R extends { id: string; kind: StoryEntry['kind']; tokens: number }>(
  series: readonly R[],
  threshold: number,
): CloseCandidate<R>[] {
  if (!Number.isFinite(threshold) || threshold <= 0) return []
  // Regenerating the newest reply, the commonest reversal, would reverse the whole close.
  const newest = series.findLastIndex(canEndChapter)
  const low = threshold / 2
  const high = threshold * 1.5
  const kept: CloseCandidate<R>[] = []
  let total = 0
  series.forEach((row, i) => {
    total += row.tokens
    if (i !== newest && canEndChapter(row) && total >= low && total <= high)
      kept.push({ ...row, tokensThrough: total })
  })
  return kept
}
