/**
 * Tests for the deterministic chapter-boundary planner used by batch
 * chapterization (importing a SillyTavern history and backfilling chapters
 * without ever calling analyzeForChapter). Pure function, no AI/DB — the
 * planner is the part most likely to silently misbehave (off-by-one
 * boundaries, ignoring the buffer, cutting mid-turn), so the math is worth
 * pinning down directly rather than only via the app.
 */

import { describe, it, expect } from 'vitest'
import { planChapterBoundaries } from './ChapterBatchPlanner'
import type { StoryEntry } from '$lib/types'

/** Entries alternate user_action/narration, each with an explicit tokenCount
 * so tests don't depend on the real tokenizer. */
function makeEntries(count: number, tokensEach: number): StoryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    storyId: 's1',
    type: i % 2 === 0 ? 'user_action' : 'narration',
    content: `entry ${i}`,
    parentId: null,
    position: i,
    createdAt: 0,
    metadata: { tokenCount: tokensEach },
    branchId: null,
  })) as StoryEntry[]
}

describe('planChapterBoundaries — basic chunking', () => {
  it('covers every entry up to the end, in contiguous, non-overlapping chunks', () => {
    const entries = makeEntries(40, 50) // 40 * 50 = 2000 tokens total
    const boundaries = planChapterBoundaries(entries, 500, 0, 0)

    expect(boundaries.length).toBeGreaterThan(0)
    expect(boundaries[0].startIndex).toBe(0)
    expect(boundaries[boundaries.length - 1].endIndex).toBe(40)

    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i].startIndex).toBe(boundaries[i - 1].endIndex)
    }
  })

  it('respects a given startIndex, e.g. resuming after existing chapters', () => {
    const entries = makeEntries(40, 50)
    const boundaries = planChapterBoundaries(entries, 500, 0, 20)

    expect(boundaries[0].startIndex).toBe(20)
    expect(boundaries[boundaries.length - 1].endIndex).toBe(40)
  })

  it('returns no boundaries when everything is inside the protected buffer', () => {
    const entries = makeEntries(5, 50)
    const boundaries = planChapterBoundaries(entries, 500, 10, 0)
    expect(boundaries).toEqual([])
  })
})

describe('planChapterBoundaries — chapterBuffer', () => {
  it('never lets a chapter reach into the protected tail', () => {
    const entries = makeEntries(40, 50)
    const buffer = 10
    const boundaries = planChapterBoundaries(entries, 500, buffer, 0)

    const lastEnd = boundaries[boundaries.length - 1].endIndex
    expect(lastEnd).toBe(40 - buffer)
  })
})

describe('planChapterBoundaries — turn-aligned cut', () => {
  it('extends a cut landing on a lone user_action to absorb the following narration', () => {
    // 5 entries * 100 tokens hits the 500 threshold exactly at index 5.
    // entries[4] (index 4, even) is a user_action; entries[5] is a narration.
    const entries = makeEntries(10, 100)
    const boundaries = planChapterBoundaries(entries, 500, 0, 0)

    const firstEnd = boundaries[0].endIndex
    expect(firstEnd).toBe(6)
    expect(entries[firstEnd - 2].type).toBe('user_action')
    expect(entries[firstEnd - 1].type).toBe('narration')
  })

  it('does not extend when the natural cut already lands on a narration', () => {
    // 4 entries * 100 tokens hits the 400 threshold exactly at index 4.
    // entries[3] (odd) is a narration — nothing to absorb.
    const entries = makeEntries(10, 100)
    const boundaries = planChapterBoundaries(entries, 400, 0, 0)

    expect(boundaries[0].endIndex).toBe(4)
  })
})

describe('planChapterBoundaries — token count fallback', () => {
  it('falls back to countTokens() when metadata.tokenCount is absent, as on ST-imported entries', () => {
    const entries: StoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      storyId: 's1',
      type: 'narration',
      content: 'word '.repeat(50),
      parentId: null,
      position: i,
      createdAt: 0,
      metadata: { source: 'sillytavern_import' },
      branchId: null,
    })) as StoryEntry[]

    // A tiny threshold forces a cut roughly every entry, proving token counts
    // were computed from content rather than treated as 0/missing.
    const boundaries = planChapterBoundaries(entries, 10, 0, 0)
    expect(boundaries.length).toBeGreaterThan(1)
  })
})

describe('planChapterBoundaries — invalid threshold validation', () => {
  it('returns an empty array for zero, negative, or NaN thresholds', () => {
    const entries = makeEntries(10, 100)
    expect(planChapterBoundaries(entries, 0, 0, 0)).toEqual([])
    expect(planChapterBoundaries(entries, -500, 0, 0)).toEqual([])
    expect(planChapterBoundaries(entries, NaN, 0, 0)).toEqual([])
  })
})

describe('planChapterBoundaries — mid-turn cut at protected buffer boundary', () => {
  it('moves maxSelectableEndIndex back one position if the last selectable is user_action and the next is narration', () => {
    const entries = makeEntries(10, 100)
    const boundaries = planChapterBoundaries(entries, 1000, 1, 0)
    const lastBoundary = boundaries[boundaries.length - 1]
    expect(lastBoundary.endIndex).toBe(8)
  })
})
