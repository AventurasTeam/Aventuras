import { describe, it, expect } from 'vitest'
import type { StoryEntry } from '$lib/types'
import { recentContent, AS_HAYSTACK, AS_PROSE } from './recentContent'

function entry(content: string, position: number): StoryEntry {
  return {
    id: `e${position}`,
    storyId: 's1',
    type: position % 2 === 0 ? 'user_action' : 'narration',
    content,
    parentId: null,
    position,
    createdAt: position,
    metadata: null,
    branchId: null,
  }
}

const entries = ['one', 'two', 'three', 'four'].map(entry)

describe('recentContent', () => {
  it('takes the tail, not the head', () => {
    expect(recentContent(entries, 2, AS_HAYSTACK)).toBe('three four')
  })

  it('joins with a single space for match haystacks', () => {
    // The separator only has to stop the last word of one entry fusing with the first of
    // the next; entityNameMatches anchors on word boundaries.
    expect(recentContent(entries, 4, AS_HAYSTACK)).toBe('one two three four')
  })

  it('joins with a blank line for prose a model reads', () => {
    expect(recentContent(entries, 2, AS_PROSE)).toBe('three\n\nfour')
  })

  it('returns everything when the count exceeds the list', () => {
    expect(recentContent(entries, 99, AS_PROSE)).toBe('one\n\ntwo\n\nthree\n\nfour')
  })

  it('returns an empty string for an empty list', () => {
    expect(recentContent([], 5, AS_PROSE)).toBe('')
  })

  it('returns nothing for a count of zero', () => {
    // Guarded explicitly, because `slice(-0)` is `slice(0)` -- the whole array. Unreachable
    // from the UI (the sliders start at 2), but the failure mode is a request carrying the
    // entire story instead of none of it.
    expect(recentContent(entries, 0, AS_HAYSTACK)).toBe('')
  })

  it('returns nothing for a negative count', () => {
    expect(recentContent(entries, -3, AS_PROSE)).toBe('')
  })

  it('is unaffected by entry type — it flattens whatever it is given', () => {
    // Callers that need only narration filter before calling; this does not.
    expect(recentContent(entries, 3, AS_HAYSTACK)).toBe('two three four')
  })
})
