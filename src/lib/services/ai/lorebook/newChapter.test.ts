import { describe, it, expect } from 'vitest'
import type { Chapter, StoryEntry } from '$lib/types'
import { MIN_RECENT_ENTRIES_FOR_LORE, splitRecentTail } from '../retrieval/recentTail'
import { renderLoreProse, loreChapterContext, loreRecentEntries } from './newChapter'

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    storyId: 'story-1',
    number: 12,
    title: 'The Ashen Gate',
    startEntryId: 'e1',
    endEntryId: 'e2',
    entryCount: 2,
    summary: 'The gate fell.',
    startTime: null,
    endTime: null,
    keywords: [],
    characters: ['Kaelen', "Vor'koth"],
    locations: ['The Citadel'],
    plotThreads: [],
    emotionalTone: null,
    branchId: null,
    createdAt: 0,
    ...overrides,
  }
}

function makeEntry(overrides: Partial<StoryEntry> = {}): StoryEntry {
  return {
    id: 'e1',
    storyId: 'story-1',
    type: 'narration',
    content: 'The gate creaked open.',
    parentId: null,
    position: 0,
    createdAt: 0,
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

describe('renderLoreProse', () => {
  it('renders entries in the [ACTION]/[NARRATIVE] shape', () => {
    expect(
      renderLoreProse([
        makeEntry({ type: 'user_action', content: 'I open the gate.' }),
        makeEntry({ type: 'narration', content: 'The gate creaks open.' }),
      ]),
    ).toBe('[ACTION] I open the gate.\n\n[NARRATIVE] The gate creaks open.')
  })

  it('drops non-prose and blank entries', () => {
    expect(
      renderLoreProse([
        makeEntry({ type: 'system', content: 'Dropped.' }),
        makeEntry({ type: 'retry', content: 'Also dropped.' }),
        makeEntry({ content: '  \n ' }),
        makeEntry({ type: 'user_action', content: '' }),
        makeEntry({ content: 'Kept.' }),
      ]),
    ).toBe('[NARRATIVE] Kept.')
  })
})

describe('loreRecentEntries', () => {
  const sized = (...lengths: number[]) =>
    lengths.map((n, i) => makeEntry({ id: `e${i}`, content: 'x'.repeat(n) }))

  describe('without a chapter', () => {
    it('shows the newest entries the budget allows, above the floor', () => {
      const tail = sized(3000, 3000, 3000, 3000, 3000, 3000, 80)
      const { shown, continues } = loreRecentEntries(tail, 2048)
      expect(shown).toEqual(splitRecentTail(tail, 2048, MIN_RECENT_ENTRIES_FOR_LORE).shown)
      expect(shown).toEqual(tail.slice(-MIN_RECENT_ENTRIES_FOR_LORE))
      expect(continues).toBe(false)
    })

    it('drops non-prose and blank entries before counting', () => {
      const first = makeEntry({ id: 'first', content: 'first' })
      const last = makeEntry({ id: 'last', content: 'last' })
      const tail = [makeEntry({ type: 'system' }), first, makeEntry({ content: '  ' }), last]
      expect(loreRecentEntries(tail, 1000).shown).toEqual([first, last])
    })

    it('returns nothing for an empty tail', () => {
      expect(loreRecentEntries([], 1000)).toEqual({ shown: [], continues: false })
    })
  })

  describe('after a chapter', () => {
    it('takes exactly entryLimit entries from the chapter end, ignoring the budget', () => {
      const tail = sized(3000, 3000, 3000, 3000, 3000, 3000, 3000, 80)
      const { shown } = loreRecentEntries(tail, 100, { entryLimit: 7 })
      expect(shown).toEqual(tail.slice(0, 7))
    })

    it('picks up where the chapter ended, not at the end of the story', () => {
      // A chapter ending at entry 59 of 120 leaves entries 60-119 as the tail.
      const tail = Array.from({ length: 60 }, (_, i) => makeEntry({ content: `entry ${60 + i}` }))
      const { shown } = loreRecentEntries(tail, 100, { entryLimit: 10 })
      expect(shown.map((e) => e.content)).toEqual(
        Array.from({ length: 10 }, (_, i) => `entry ${60 + i}`),
      )
    })

    it('without a limit, takes the oldest entries the budget allows', () => {
      // 100 + 5 × 102 = 610 fits in 700; a seventh entry would not.
      const tail = sized(100, 100, 100, 100, 100, 100, 100, 100, 100, 100)
      expect(loreRecentEntries(tail, 700, {}).shown).toEqual(tail.slice(0, 6))
    })

    it('without a limit, still honours the floor', () => {
      const tail = sized(3000, 3000, 3000, 3000, 3000, 3000, 3000, 80)
      expect(loreRecentEntries(tail, 2048, {}).shown).toEqual(
        tail.slice(0, MIN_RECENT_ENTRIES_FOR_LORE),
      )
    })

    it('counts only entries the agent will actually see', () => {
      const prose = sized(10, 10, 10, 10)
      const tail = [
        makeEntry({ content: ' ' }),
        prose[0],
        makeEntry({ type: 'system' }),
        ...prose.slice(1),
      ]
      expect(loreRecentEntries(tail, 1000, { entryLimit: 3 }).shown).toEqual(prose.slice(0, 3))
      expect(loreRecentEntries(tail, 1000, {}).shown).toEqual(prose)
    })

    it('shows nothing when the limit is 0 or negative', () => {
      const tail = sized(10, 10, 10)
      expect(loreRecentEntries(tail, 1000, { entryLimit: 0 }).shown).toEqual([])
      expect(loreRecentEntries(tail, 1000, { entryLimit: -2 }).shown).toEqual([])
    })

    it('reports that the story continues when a limit of 0 leaves prose unshown', () => {
      expect(loreRecentEntries(sized(10, 10), 1000, { entryLimit: 0 }).continues).toBe(true)
      expect(loreRecentEntries([], 1000, { entryLimit: 0 }).continues).toBe(false)
    })

    it('shows every entry when the limit exceeds the tail', () => {
      const tail = sized(10, 10)
      expect(loreRecentEntries(tail, 1000, { entryLimit: 5 }).shown).toEqual(tail)
    })

    it('returns nothing for an empty tail', () => {
      expect(loreRecentEntries([], 1000, {})).toEqual({ shown: [], continues: false })
    })

    it('reports that the story continues only when the excerpt stops short', () => {
      const tail = sized(10, 10, 10, 10)
      expect(loreRecentEntries(tail, 1000, { entryLimit: 2 }).continues).toBe(true)
      expect(loreRecentEntries(tail, 1000, { entryLimit: 4 }).continues).toBe(false)
      expect(loreRecentEntries(tail, 1000, { entryLimit: 9 }).continues).toBe(false)
      expect(loreRecentEntries(tail, 1000, {}).continues).toBe(false)
      expect(loreRecentEntries(sized(10, 10, 10, 10, 10, 10, 10, 10), 25, {}).continues).toBe(true)
    })
  })
})

describe('loreChapterContext', () => {
  const earlier = makeChapter({ id: 'a', number: 1, title: 'First', summary: 'One' })
  const current = makeChapter({ id: 'b', number: 2, title: 'Second', summary: 'Two' })
  const chapters = [earlier, current]
  const prose = [makeEntry({ type: 'user_action', content: 'I open the gate.' })]

  it('sends the chapter in full and drops its summary when the setting is on', () => {
    const result = loreChapterContext(chapters, { chapter: current, entries: prose }, true)
    expect(result.newChapterSection).toBe(
      "# Chapter 2: Second — just written, in full\n*Characters: Kaelen, Vor'koth | Locations: The Citadel*\n\n[ACTION] I open the gate.\n",
    )
    expect(result.chapters).toEqual([{ number: 1, title: 'First', summary: 'One' }])
  })

  it('omits the header title when the chapter has none', () => {
    const chapter = makeChapter({ title: null })
    const { newChapterSection } = loreChapterContext([chapter], { chapter, entries: prose }, true)
    expect(newChapterSection).toContain('# Chapter 12 — just written, in full\n')
  })

  it('prints only the facets that are present', () => {
    const chapter = makeChapter({ locations: [] })
    const { newChapterSection } = loreChapterContext([chapter], { chapter, entries: prose }, true)
    expect(newChapterSection).toContain("*Characters: Kaelen, Vor'koth*\n")
  })

  it('omits the facet line entirely when both are absent', () => {
    // Legacy chapter, persisted before the fields existed: undefined at runtime despite the type.
    const chapter = makeChapter({
      characters: undefined as unknown as string[],
      locations: undefined as unknown as string[],
    })
    const { newChapterSection } = loreChapterContext([chapter], { chapter, entries: prose }, true)
    expect(newChapterSection).toBe(
      '# Chapter 12: The Ashen Gate — just written, in full\n\n[ACTION] I open the gate.\n',
    )
  })

  it.each([
    ['the setting is off', { chapter: current, entries: prose }, false],
    ['the chapter has no entries', { chapter: current, entries: [] }, true],
    [
      'the chapter has only blank or non-prose entries',
      {
        chapter: current,
        entries: [makeEntry({ content: '  ' }), makeEntry({ type: 'system' })],
      },
      true,
    ],
    ['there is no new chapter', undefined, true],
  ])('keeps every summary and sends no section when %s', (_, newChapter, sendFullText) => {
    const result = loreChapterContext(chapters, newChapter, sendFullText)
    expect(result.newChapterSection).toBe('')
    expect(result.chapters).toHaveLength(2)
  })
})
