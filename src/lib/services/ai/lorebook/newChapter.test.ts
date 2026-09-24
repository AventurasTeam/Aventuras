import { describe, it, expect } from 'vitest'
import type { Chapter, StoryEntry } from '$lib/types'
import {
  buildNewChapterPayload,
  formatNewChapterSection,
  chapterSummariesExcluding,
  loreChapterContext,
} from './newChapter'

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

describe('buildNewChapterPayload', () => {
  it('renders entries in the [ACTION]/[NARRATIVE] shape', () => {
    const payload = buildNewChapterPayload(makeChapter(), [
      makeEntry({ type: 'user_action', content: 'I open the gate.' }),
      makeEntry({ type: 'narration', content: 'The gate creaks open.' }),
    ])
    expect(payload?.text).toBe('[ACTION] I open the gate.\n\n[NARRATIVE] The gate creaks open.')
  })

  it('filters out entries that are not narration or a user action', () => {
    const payload = buildNewChapterPayload(makeChapter(), [
      makeEntry({ type: 'narration', content: 'Kept.' }),
      makeEntry({ type: 'system', content: 'Dropped.' }),
      makeEntry({ type: 'retry', content: 'Also dropped.' }),
    ])
    expect(payload?.text).toBe('[NARRATIVE] Kept.')
  })

  it('carries number, title, characters and locations from the chapter', () => {
    const payload = buildNewChapterPayload(makeChapter(), [makeEntry()])
    expect(payload?.number).toBe(12)
    expect(payload?.title).toBe('The Ashen Gate')
    expect(payload?.characters).toEqual(['Kaelen', "Vor'koth"])
    expect(payload?.locations).toEqual(['The Citadel'])
  })

  it('returns null when there is nothing to show', () => {
    // story.getChapterEntries() returns [] when it cannot place the chapter's boundary
    // ids. The caller must not drop the chapter's summary on a null payload — see loreChapterContext.
    expect(buildNewChapterPayload(makeChapter(), [])).toBeNull()
  })

  it('returns null when every entry is filtered out', () => {
    expect(buildNewChapterPayload(makeChapter(), [makeEntry({ type: 'system' })])).toBeNull()
  })

  it('drops blank entries, so a chapter of only whitespace is null', () => {
    const blank = [makeEntry({ content: '  \n ' }), makeEntry({ type: 'user_action', content: '' })]
    expect(buildNewChapterPayload(makeChapter(), blank)).toBeNull()
    expect(buildNewChapterPayload(makeChapter(), [...blank, makeEntry()])?.text).toBe(
      '[NARRATIVE] The gate creaked open.',
    )
  })
})

describe('formatNewChapterSection', () => {
  it('renders the header, facet line and body', () => {
    const payload = buildNewChapterPayload(makeChapter(), [
      makeEntry({ type: 'user_action', content: 'I open the gate.' }),
    ])
    expect(formatNewChapterSection(payload!)).toBe(
      "# Chapter 12: The Ashen Gate — just written, in full\n*Characters: Kaelen, Vor'koth | Locations: The Citadel*\n\n[ACTION] I open the gate.\n",
    )
  })

  it('omits the header title when the chapter has none', () => {
    const payload = buildNewChapterPayload(makeChapter({ title: null }), [makeEntry()])
    expect(formatNewChapterSection(payload!)).toContain('# Chapter 12 — just written, in full')
  })

  it('prints only the facets that are present', () => {
    const payload = buildNewChapterPayload(makeChapter({ locations: [] }), [makeEntry()])
    expect(formatNewChapterSection(payload!)).toContain("*Characters: Kaelen, Vor'koth*\n")
  })

  it('omits the facet line entirely when both are absent', () => {
    // Legacy chapter, persisted before the fields existed: undefined at runtime despite the type.
    const payload = buildNewChapterPayload(
      makeChapter({
        characters: undefined as unknown as string[],
        locations: undefined as unknown as string[],
      }),
      [makeEntry()],
    )
    expect(formatNewChapterSection(payload!)).toBe(
      '# Chapter 12: The Ashen Gate — just written, in full\n\n[NARRATIVE] The gate creaked open.\n',
    )
  })
})

describe('chapterSummariesExcluding', () => {
  const chapters = [
    makeChapter({ id: 'a', number: 1, title: 'First', summary: 'One' }),
    makeChapter({ id: 'b', number: 2, title: 'Second', summary: 'Two' }),
    makeChapter({ id: 'c', number: 3, title: 'Third', summary: 'Three' }),
  ]

  it('drops the named chapter and keeps the others in order', () => {
    const result = chapterSummariesExcluding(chapters, 'b')
    expect(result).toEqual([
      { number: 1, title: 'First', summary: 'One' },
      { number: 3, title: 'Third', summary: 'Three' },
    ])
  })

  it('keeps every chapter when no id is given', () => {
    expect(chapterSummariesExcluding(chapters)).toHaveLength(3)
  })

  it('is a no-op when the id matches nothing', () => {
    expect(chapterSummariesExcluding(chapters, 'nope')).toHaveLength(3)
  })

  it('returns an empty list when the only chapter is the excluded one', () => {
    expect(chapterSummariesExcluding([chapters[0]], 'a')).toEqual([])
  })
})

describe('loreChapterContext', () => {
  const earlier = makeChapter({ id: 'a', number: 1, title: 'First', summary: 'One' })
  const current = makeChapter({ id: 'b', number: 2, title: 'Second', summary: 'Two' })
  const chapters = [earlier, current]
  const prose = [makeEntry()]

  it('sends the chapter in full and drops its summary when the setting is on', () => {
    const result = loreChapterContext(chapters, { chapter: current, entries: prose }, true)
    expect(result.newChapter?.text).toBe('[NARRATIVE] The gate creaked open.')
    expect(result.chapters).toEqual([{ number: 1, title: 'First', summary: 'One' }])
  })

  it('keeps every summary and sends no payload when the setting is off', () => {
    const result = loreChapterContext(chapters, { chapter: current, entries: prose }, false)
    expect(result.newChapter).toBeNull()
    expect(result.chapters).toHaveLength(2)
  })

  it('keeps the summary when the chapter has no prose to send', () => {
    const result = loreChapterContext(chapters, { chapter: current, entries: [] }, true)
    expect(result.newChapter).toBeNull()
    expect(result.chapters).toHaveLength(2)
  })

  it('keeps every summary when there is no new chapter', () => {
    const result = loreChapterContext(chapters, undefined, true)
    expect(result.newChapter).toBeNull()
    expect(result.chapters).toHaveLength(2)
  })
})
