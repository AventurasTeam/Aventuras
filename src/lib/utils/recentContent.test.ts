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

  describe('roles', () => {
    const typed = (type: StoryEntry['type']): StoryEntry => ({ ...entry('said', 0), type })

    it('labels who produced each entry', () => {
      // The fixture alternates by index: 'three' is index 2, so it is the player's.
      expect(recentContent(entries, 2, AS_PROSE, { roles: true })).toBe(
        '[Player Action]: three\n\n[Narrator]: four',
      )
    })

    it('never puts an internal type identifier in the prompt', () => {
      // Nothing creates these today; they survive in stories saved by older versions.
      const labelled = recentContent([typed('system'), typed('retry')], 2, AS_PROSE, {
        roles: true,
      })

      expect(labelled).not.toContain('[system]')
      expect(labelled).not.toContain('[retry]')
      expect(labelled).toBe('[System Note]: said\n\n[Narrator]: said')
    })

    it('calls a retry a narration, because that is what the model is being shown', () => {
      expect(recentContent([typed('retry')], 1, AS_PROSE, { roles: true })).toBe('[Narrator]: said')
    })

    it('leaves the content untouched with no options', () => {
      expect(recentContent(entries, 2, AS_PROSE)).toBe('three\n\nfour')
    })
  })

  describe('time', () => {
    const stamped = (content: string, hours: number): StoryEntry => ({
      ...entry(content, 1),
      metadata: { timeStart: { years: 0, days: 10, hours, minutes: 5 } },
    })

    it('stamps the in-story clock the entry began at', () => {
      expect(recentContent([stamped('a', 17)], 1, AS_PROSE, { roles: true, time: true })).toBe(
        '[Narrator] (at Y0D10 17:05): a',
      )
    })

    it('pads hours and minutes to two digits, and opens the line without the role', () => {
      expect(recentContent([stamped('a', 9)], 1, AS_PROSE, { time: true })).toBe(
        '(at Y0D10 09:05): a',
      )
    })

    it('leaves entries that carry no time unstamped', () => {
      expect(recentContent(entries, 1, AS_PROSE, { roles: true, time: true })).toBe(
        '[Narrator]: four',
      )
    })
  })

  describe('transform', () => {
    it('rewrites each entry before it is labelled', () => {
      expect(
        recentContent(entries, 2, AS_PROSE, { roles: true, transform: (c) => c.toUpperCase() }),
      ).toBe('[Player Action]: THREE\n\n[Narrator]: FOUR')
    })
  })
})
