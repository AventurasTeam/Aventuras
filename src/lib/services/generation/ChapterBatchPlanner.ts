/**
 * ChapterBatchPlanner - Pure boundary planning for batch chapterization.
 * Splits a flat list of entries into chapter-sized chunks using the same
 * token-threshold/buffer math as story.tokensOutsideBuffer, without any AI call.
 */

import type { StoryEntry } from '$lib/types'
import { countTokens } from '$lib/services/tokenizer'

export interface ChapterBoundary {
  startIndex: number
  endIndex: number
}

function entryTokenCount(entry: StoryEntry): number {
  return entry.metadata?.tokenCount ?? countTokens(entry.content)
}

/**
 * Plan chapter boundaries for entries[startIndex..] by greedily accumulating
 * tokens until tokenThreshold is reached, stopping short of the protected
 * tail (chapterBuffer). A boundary that would land right after a user_action
 * is extended by one entry to absorb the following narration, so a chapter
 * never ends mid-turn.
 */
export function planChapterBoundaries(
  entries: StoryEntry[],
  tokenThreshold: number,
  chapterBuffer: number,
  startIndex: number,
): ChapterBoundary[] {
  if (!tokenThreshold || tokenThreshold <= 0 || isNaN(tokenThreshold)) {
    return []
  }

  const boundaries: ChapterBoundary[] = []
  const protectedCount = Math.max(0, chapterBuffer)
  let maxSelectableEndIndex = Math.max(0, entries.length - protectedCount)

  if (
    maxSelectableEndIndex > 0 &&
    maxSelectableEndIndex < entries.length &&
    entries[maxSelectableEndIndex - 1].type === 'user_action' &&
    entries[maxSelectableEndIndex].type === 'narration'
  ) {
    maxSelectableEndIndex--
  }

  let cursor = Math.max(0, startIndex)

  while (cursor < maxSelectableEndIndex) {
    let tokens = 0
    let end = cursor

    while (end < maxSelectableEndIndex && tokens < tokenThreshold) {
      tokens += entryTokenCount(entries[end])
      end++
    }

    // Turn-aligned cut: don't end a chapter right after a lone user_action.
    if (
      end < maxSelectableEndIndex &&
      entries[end - 1].type === 'user_action' &&
      entries[end].type === 'narration'
    ) {
      end++
    }

    boundaries.push({ startIndex: cursor, endIndex: end })
    cursor = end
  }

  return boundaries
}
