import { describe, it, expect } from 'vitest'
import type { Chapter, StoryEntry } from '$lib/types'
import { renderLoreProse, loreChapterContext } from './newChapter'

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
