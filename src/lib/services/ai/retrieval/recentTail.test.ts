import { describe, it, expect } from 'vitest'
import { MIN_RECENT_ENTRIES_FOR_LORE, loreRecentEntries, splitRecentTail } from './recentTail'
import type { StoryEntry } from '$lib/types'

const entry = (content: string): StoryEntry => ({ type: 'narration', content }) as StoryEntry

/** Entries of a known size, oldest first, so budgets can be reasoned about exactly. */
const sized = (...lengths: number[]) => lengths.map((n) => entry('x'.repeat(n)))

describe('splitRecentTail', () => {
  it('shows everything when it all fits', () => {
    const tail = sized(10, 10, 10)
    const { shown, searchable } = splitRecentTail(tail, 1000)

    expect(shown).toEqual(tail)
    expect(searchable).toEqual([])
  })

  it('keeps the newest entries and leaves the rest searchable', () => {
    const tail = sized(100, 100, 100, 100)
    // Two entries plus one join separator fit in 205; a third does not.
    const { shown, searchable } = splitRecentTail(tail, 205)

    expect(shown).toEqual(tail.slice(2))
    expect(searchable).toEqual(tail.slice(0, 2))
  })

  it('never puts an entry in both halves', () => {
    const tail = sized(100, 100, 100, 100)
    const { shown, searchable } = splitRecentTail(tail, 205)

    expect([...searchable, ...shown]).toEqual(tail)
  })

  it('shows the newest entry even when it alone exceeds the budget', () => {
    // An empty scene would leave the agent unable to tell the story has a present at all.
    const tail = sized(50, 5000)
    const { shown, searchable } = splitRecentTail(tail, 100)

    expect(shown).toEqual(tail.slice(1))
    expect(searchable).toEqual(tail.slice(0, 1))
  })

  it('handles an empty tail', () => {
    expect(splitRecentTail([], 100)).toEqual({ shown: [], searchable: [] })
  })

  it('tolerates entries with no content', () => {
    const tail = [entry(''), entry('recent')]
    const { shown } = splitRecentTail(tail, 100)

    expect(shown).toEqual(tail)
  })
})

describe('splitRecentTail — the minimum-entries floor', () => {
  it('keeps the floor even when the budget is far smaller', () => {
    // The measured failure: a tiny player action followed by full-size narrations, and a
    // cap below the size of one of them. Without the floor `shown` is the action alone,
    // and the agent's RECENT SCENE just repeats its own USER INPUT.
    const tail = sized(3000, 3000, 3000, 80)
    const { shown, searchable } = splitRecentTail(tail, 2048, 4)

    expect(shown).toEqual(tail)
    expect(searchable).toEqual([])
  })

  it('stops at the floor rather than taking everything', () => {
    const tail = sized(3000, 3000, 3000, 3000, 3000, 80)
    const { shown, searchable } = splitRecentTail(tail, 2048, 4)

    expect(shown).toEqual(tail.slice(-4))
    expect(searchable).toEqual(tail.slice(0, 2))
  })

  it('lets the budget win above the floor', () => {
    // Ten small entries, a floor of 2, and room for more than two: the cap decides.
    const tail = sized(...Array(10).fill(100))
    const { shown } = splitRecentTail(tail, 510, 2)

    expect(shown.length).toBeGreaterThan(2)
    expect(shown.length).toBeLessThan(10)
  })

  it('cannot ask for more entries than the tail has', () => {
    const tail = sized(50, 50)
    expect(splitRecentTail(tail, 10, 9).shown).toEqual(tail)
  })

  it('defaults to a floor of one, preserving the original contract', () => {
    const tail = sized(50, 5000)
    expect(splitRecentTail(tail, 100).shown).toEqual(tail.slice(1))
  })

  it('treats a floor below one as one', () => {
    const tail = sized(50, 5000)
    expect(splitRecentTail(tail, 100, 0).shown).toEqual(tail.slice(1))
  })
})

describe('loreRecentEntries', () => {
  const typed = (type: StoryEntry['type'], content = 'x'.repeat(100)) =>
    ({ type, content }) as StoryEntry

  it('falls back to the character budget and floor when no limit is given', () => {
    const tail = sized(3000, 3000, 3000, 3000, 3000, 3000, 80)
    expect(loreRecentEntries(tail, 2048)).toEqual(
      splitRecentTail(tail, 2048, MIN_RECENT_ENTRIES_FOR_LORE).shown,
    )
  })

  it('shows the first N entries after the chapter, ignoring the character budget', () => {
    const tail = sized(3000, 3000, 3000, 3000, 3000, 3000, 3000, 80)
    expect(loreRecentEntries(tail, 100, 7)).toEqual(tail.slice(0, 7))
  })

  it('picks up where the chapter ended, not at the end of the story', () => {
    // A chapter ending at entry 59 of 120 leaves entries 60-119 as the tail.
    const tail = Array.from({ length: 60 }, (_, i) => entry(`entry ${60 + i}`))
    const shown = loreRecentEntries(tail, 100, 10)
    expect(shown.map((e) => e.content)).toEqual(
      Array.from({ length: 10 }, (_, i) => `entry ${60 + i}`),
    )
  })

  it('shows nothing when the limit is 0 or negative', () => {
    const tail = sized(10, 10, 10)
    expect(loreRecentEntries(tail, 1000, 0)).toEqual([])
    expect(loreRecentEntries(tail, 1000, -2)).toEqual([])
  })

  it('shows every entry when the limit exceeds the tail', () => {
    const tail = sized(10, 10)
    expect(loreRecentEntries(tail, 1000, 5)).toEqual(tail)
  })

  it('drops non-prose entries before counting', () => {
    const first = typed('narration', 'first')
    const action = typed('user_action', 'action')
    const last = typed('narration', 'last')
    const tail = [typed('system'), first, typed('retry'), action, last]
    expect(loreRecentEntries(tail, 1000, 2)).toEqual([first, action])
    expect(loreRecentEntries(tail, 1000)).toEqual([first, action, last])
  })
})
