import { describe, it, expect } from 'vitest'
import {
  createRetrievalTools,
  MAX_EXCERPT_WORDS,
  MAX_CHAPTER_QUERIES,
  MAX_GREP_EXCERPTS,
  UNCHAPTERIZED,
  type RetrievalToolContext,
} from './retrieval'
import type { Chapter, StoryEntry } from '$lib/types'

function chapter(number: number, summary: string, title: string | null = null): Chapter {
  return { number, title, summary } as Chapter
}

function narration(content: string): StoryEntry {
  return { type: 'narration', content } as StoryEntry
}

/** Minimal context: only the fields grep_chapters actually reads. */
function makeContext(overrides: Partial<RetrievalToolContext> = {}): RetrievalToolContext {
  return {
    entries: [],
    chapters: [],
    onEvent: () => {},
    describeProgress: () => 'progress',
    getChapterEntries: () => [],
    // Off in production (experimental), so these tests have to ask for it. The exposure
    // block below covers the off case.
    grepEnabled: true,
    ...overrides,
  }
}

/** grep_chapters' execute(), with the arg shape the AI SDK passes through. */
type GrepArgs = {
  query: string
  chapterNumbers?: number[]
  wholeWord?: boolean
  caseSensitive?: boolean
}
function grepOf(context: RetrievalToolContext) {
  const tools = createRetrievalTools(context) as Record<string, any>
  const grep = tools.grep_chapters
  if (!grep) return null
  return (args: GrepArgs) => grep.execute(args, {} as any)
}

/** A paragraph of `n` words, wordy enough that the excerpt floor does not grow the window. */
const para = (text: string, n = 20) => `${text} ${Array(n).fill('filler').join(' ')}`

/** `count` hits, spaced far enough apart to stay in separate passages. */
const spacedHits = (count: number, gap = 3) =>
  [...Array(count * (gap + 1))]
    .map((_, i) => (i % (gap + 1) === 0 ? para('Aria here') : para(`p${i}`)))
    .join('\n\n')

describe('grep_chapters — exposure', () => {
  const withChapters = { chapters: [chapter(1, 'Aria leaves the village.')] }

  it('is not registered when there are no chapters', () => {
    expect(grepOf(makeContext({ chapters: [] }))).toBeNull()
  })

  it('is not registered when the chapter lookup is unavailable', () => {
    // Registering it would burn a tool slot on a call that can only fail. Note the
    // chapters: without them this would pass for the wrong reason.
    expect(grepOf(makeContext({ ...withChapters, getChapterEntries: undefined }))).toBeNull()
  })

  it('is not registered when the feature is switched off', () => {
    // The whole point of the setting, and it used to reach only the prompt template: the
    // model was handed the tool regardless, while being told -- by the non-grep branch of
    // that same template -- that query_chapter was its only way into the past.
    expect(grepOf(makeContext({ ...withChapters, grepEnabled: false }))).toBeNull()
  })

  it('leaves the other chapter tools alone when grep is off', () => {
    // Only grep is gated. query_chapter needs chapters and nothing else.
    const tools = createRetrievalTools(
      makeContext({ ...withChapters, grepEnabled: false }),
    ) as Record<string, unknown>

    expect(tools.grep_chapters).toBeUndefined()
    expect(tools.query_chapter).toBeDefined()
    expect(tools.search_entries).toBeDefined()
    expect(tools.finish_retrieval).toBeDefined()
  })

  it('is registered when chapters, a lookup and the flag are all present', () => {
    expect(grepOf(makeContext(withChapters))).not.toBeNull()
  })
})

describe('grep_chapters — results', () => {
  const chapters = [chapter(1, 'Aria leaves the village.'), chapter(2, 'The tower is reached.')]
  const byChapter: Record<number, StoryEntry[]> = {
    1: [narration('Aria drew her blade.\n\nThe road was long.')],
    2: [narration('The tower loomed.\n\nAria climbed it.')],
  }

  const context = makeContext({
    chapters,
    getChapterEntries: (c) => byChapter[c.number] ?? [],
  })

  it('searches chapters and returns matching excerpts', async () => {
    const result = await grepOf(context)!({ query: 'Aria' })

    expect(result.totalMatches).toBe(2)
    expect(result.excerptsShown).toBe(2)
    expect(result.excerpts).toHaveLength(2)
    expect(result.excerpts.map((e: any) => e.chapter)).toEqual([1, 2])
  })

  it('restricts search to specified chapterNumbers when provided', async () => {
    const result = await grepOf(context)!({ query: 'Aria', chapterNumbers: [2] })

    expect(result.searchedChapters).toEqual([2])
    expect(result.totalMatches).toBe(1)
    expect(result.excerpts[0].chapter).toBe(2)
  })

  it('honours caseSensitive option', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 's')],
      getChapterEntries: () => [narration('she lost hope'), narration('the bookmark read HOPE')],
    })

    expect((await grepOf(ctx)!({ query: 'HOPE' })).totalMatches).toBe(2)
    expect((await grepOf(ctx)!({ query: 'HOPE', caseSensitive: true })).totalMatches).toBe(1)
  })

  it('honours wholeWord option', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 's')],
      getChapterEntries: () => [narration('he counted the swords')],
    })

    expect((await grepOf(ctx)!({ query: 'sword' })).totalMatches).toBe(1)
    expect((await grepOf(ctx)!({ query: 'sword', wholeWord: true })).totalMatches).toBe(0)
  })

  it('includes unchapterized tail when available', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 's')],
      getChapterEntries: () => [narration('Old chapter content')],
      getUnchapterizedEntries: () => [narration('Recent unchapterized text featuring Aria.')],
    })

    const result = await grepOf(ctx)!({ query: 'Aria' })

    expect(result.totalMatches).toBe(1)
    expect(result.excerpts[0].chapter).toBe(UNCHAPTERIZED)
    expect(result.excerpts[0].chapterTitle).toBe('Recent (Unchapterized)')
  })

  it('searches the unchapterized tail when it is asked for by number', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 's')],
      getChapterEntries: () => [narration('Old chapter mentioning Aria.')],
      getUnchapterizedEntries: () => [narration('Recent unchapterized text featuring Aria.')],
    })

    const result = await grepOf(ctx)!({ query: 'Aria', chapterNumbers: [UNCHAPTERIZED] })

    // The tail only -- not the chapter, which also matches.
    expect(result.totalMatches).toBe(1)
    expect(result.excerpts[0].excerpt).toContain('Recent unchapterized')
  })

  it('reports per-chapter counts, including chapters no excerpt was spent on', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 'a'), chapter(2, 'b')],
      getChapterEntries: (c) =>
        c.number === 1
          ? [narration('Aria one.'), narration('Aria two.'), narration('Aria three.')]
          : [narration('Aria alone.')],
      grepExcerptsPerSearch: 1,
    })

    const result = await grepOf(ctx)!({ query: 'Aria' })

    expect(result.totalMatches).toBe(4)
    expect(result.excerptsShown).toBe(1)
    // Chapter 2 matched and got nothing; the count is what says so.
    expect(result.matchesByChapter).toEqual([
      { chapter: 1, title: 'Chapter 1', matches: 3, matchesShown: 1 },
      { chapter: 2, title: 'Chapter 2', matches: 1, matchesShown: 0 },
    ])
  })

  it('counts shown matches in the same unit as total matches', async () => {
    // Two adjacent hits share one quote. Reporting "2 matches, 1 shown" would send the
    // agent looking for a match it has already read.
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration('Aria spoke.\n\nAria left.')],
    })

    const result = await grepOf(ctx)!({ query: 'Aria' })

    expect(result.excerptsShown).toBe(1)
    expect(result.matchesByChapter[0]).toMatchObject({ matches: 2, matchesShown: 2 })
  })

  it('does not claim hits that the length cap cut out of the passage', async () => {
    // One passage, two hits, but far more words than the excerpt budget -- so only the
    // hit it is centred on is guaranteed readable.
    const filler = Array(120).fill('filler').join(' ')
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration(`Aria one. ${filler}\n\n${filler} Aria two.`)],
    })

    const result = await grepOf(ctx)!({ query: 'Aria' })

    expect(result.matchesByChapter[0]).toMatchObject({ matches: 2, matchesShown: 1 })
  })

  it('counts every hit in an entry, not just the entry', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration('Aria spoke.\n\nSilence.\n\nAria left.')],
    })

    const result = await grepOf(ctx)!({ query: 'Aria' })

    // Both hits counted; they are close enough to share one quoted passage, and that
    // passage does contain both -- nothing is counted but invisible.
    expect(result.totalMatches).toBe(2)
    expect(result.excerpts).toHaveLength(1)
    expect(result.excerpts[0].excerpt).toContain('Aria spoke')
    expect(result.excerpts[0].excerpt).toContain('Aria left')
  })

  it('counts matching paragraphs, not passages, so window width cannot skew the count', async () => {
    const content = 'Aria one.\n\nx\n\ny\n\nz\n\nAria two.'
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration(content)],
    })

    // Whether these two hits land in one merged passage or two, the count is 2.
    const result = await grepOf(ctx)!({ query: 'Aria' })
    expect(result.totalMatches).toBe(2)
  })

  it('honours the per-search quote cap', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration(spacedHits(3))],
      grepExcerptsPerSearch: 2,
    })

    const result = await grepOf(ctx)!({ query: 'Aria' })

    expect(result.excerptsShown).toBe(2)
    expect(result.sampled).toBe(true)
  })

  it('gives every call the same allowance, whatever ran before it', async () => {
    // There is no run-wide budget any more, and this is the case that killed it: a broad
    // exploratory search used to eat the quota, so the *narrowed* follow-up -- the one that
    // answers the question and avoids a query_chapter -- was rationed for arriving second.
    // Measured on a real turn: 40 excerpts to the broad grep, and the narrowed grep cut
    // from 32 to 20.
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration(spacedHits(3))],
      grepExcerptsPerSearch: 2,
    })
    const grep = grepOf(ctx)!

    const first = await grep({ query: 'Aria' })
    expect(first.excerptsShown).toBe(2)

    const second = await grep({ query: 'Aria', wholeWord: true })
    expect(second.totalMatches).toBe(3)
    expect(second.excerptsShown).toBe(2)
    expect(second.note ?? '').not.toContain('quota')
  })

  it('replays an identical search rather than recomputing it', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration('Aria one.\n\nx\n\nAria two.')],
      grepExcerptsPerSearch: 2,
    })
    const grep = grepOf(ctx)!

    const first = await grep({ query: 'Aria' })
    const repeat = await grep({ query: 'Aria' })

    expect(repeat.excerpts).toEqual(first.excerpts)
    expect(repeat.repeatedSearch).toBeTruthy()
  })

  it('always quotes a paragraph either side of the hit', async () => {
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration('before\n\nAria here\n\nafter')],
    })

    const excerpt = (await grepOf(ctx)!({ query: 'Aria' })).excerpts[0].excerpt
    expect(excerpt).toContain('before')
    expect(excerpt).toContain('after')
  })
})

describe('query_chapter', () => {
  const chapters = [chapter(1, 'Aria leaves the village.', 'Departure')]

  function queryOf(context: RetrievalToolContext) {
    const tools = createRetrievalTools(context) as Record<string, any>
    return (args: { chapterNumber: number; question: string }) =>
      tools.query_chapter.execute(args, {} as any)
  }

  it('returns the answer without echoing the summary back', async () => {
    const result = await queryOf(
      makeContext({ chapters, onQueryChapter: async () => 'She left at dawn.' }),
    )({ chapterNumber: 1, question: 'when did she leave?' })

    expect(result.answered).toBe(true)
    expect(result.answer).toBe('She left at dawn.')
    expect(result.chapterTitle).toBe('Departure')
    expect(JSON.stringify(result)).not.toContain('Aria leaves the village.')
  })

  it('lets a callback failure propagate rather than handling it a second way', async () => {
    // AgenticRetrievalService's callback turns failures into a cached answer so the agent
    // does not re-ask a failing question, and records the failure in the transcript.
    // Catching here too would bypass both.
    await expect(
      queryOf(
        makeContext({
          chapters,
          onQueryChapter: async () => {
            throw new Error('provider down')
          },
        }),
      )({ chapterNumber: 1, question: 'when did she leave?' }),
    ).rejects.toThrow('provider down')
  })

  it('keeps the match in view when it sits far into a long entry', async () => {
    const longText = `${Array(200).fill('before').join(' ')} Excalibur ${Array(200).fill('after').join(' ')}`
    const ctx = makeContext({
      chapters: [chapter(1, 'Title')],
      getChapterEntries: () => [narration(longText)],
    })

    const result = await grepOf(ctx)!({ query: 'Excalibur' })

    expect(result.totalMatches).toBe(1)
    expect(result.excerpts[0].excerpt).toContain('Excalibur')
    expect(result.excerpts[0].excerpt.startsWith('…')).toBe(true)
    expect(result.excerpts[0].excerpt.endsWith('…')).toBe(true)
  })

  it('widens the excerpts when a search returns few passages', async () => {
    // The budget is a volume of prose, not a count of snippets: with one hit there is room
    // to show it properly, and a lone fragment is the least useful kind of result.
    const long = Array(400).fill('filler').join(' ')
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [narration(`${long} Excalibur ${long}`)],
    })

    const words = (await grepOf(ctx)!({ query: 'Excalibur' })).excerpts[0].excerpt.split(/\s+/)

    expect(words.length).toBeGreaterThan(MAX_EXCERPT_WORDS)
  })

  it('labels whether a passage is narration or something the player typed', async () => {
    // Otherwise the agent can hand the player's own words back to the narrator as fact.
    const ctx = makeContext({
      chapters: [chapter(1, 'a')],
      getChapterEntries: () => [
        narration(para('Aria drew the blade')),
        { type: 'user_action', content: para('i ask Aria about the blade') } as StoryEntry,
      ],
    })

    const roles = (await grepOf(ctx)!({ query: 'Aria' })).excerpts.map((e: any) => e.role)

    expect(roles).toEqual(['NARRATIVE', 'ACTION'])
  })

  it('only emits onEvent in query_chapter when onQueryChapter is not provided', async () => {
    const events: any[] = []
    const onEvent = (e: any) => events.push(e)
    const chapters = [chapter(1, 'Summary', 'Departure')]

    // Case 1: onQueryChapter is provided (wrapper handles event logging)
    const toolsWithHandler = createRetrievalTools(
      makeContext({
        chapters,
        onEvent,
        onQueryChapter: async () => 'Answer',
      }),
    ) as Record<string, any>

    await toolsWithHandler.query_chapter.execute({ chapterNumber: 1, question: 'Q?' }, {} as any)
    expect(events.length).toBe(0)

    // Case 2: onQueryChapter is absent (tool emits fallback event)
    const toolsWithoutHandler = createRetrievalTools(
      makeContext({
        chapters,
        onEvent,
        onQueryChapter: undefined,
      }),
    ) as Record<string, any>

    await toolsWithoutHandler.query_chapter.execute({ chapterNumber: 1, question: 'Q?' }, {} as any)
    expect(events.length).toBe(1)
    expect(events[0].kind).toBe('query')
  })
})

describe('search_entries', () => {
  const lorebookEntries = [
    {
      id: 'e-orc',
      name: 'Orc',
      type: 'faction',
      description: 'Green folk of the hills.',
      aliases: [],
      injection: { keywords: [], priority: 5, mode: 'keyword' },
    },
    {
      id: 'e-rec',
      name: 'The Record',
      type: 'concept',
      description: 'A ledger kept by the orchestra.',
      aliases: [],
      injection: { keywords: [], priority: 5, mode: 'keyword' },
    },
  ] as any[]

  function toolsFor(onEvent: RetrievalToolContext['onEvent'] = () => {}) {
    return createRetrievalTools(makeContext({ entries: lorebookEntries, onEvent })) as Record<
      string,
      any
    >
  }

  it('does not match a name inside an unrelated word', async () => {
    // 'orc' must not drag in "orchestra" — the substring bug this shares with lorebook
    // keyword matching.
    const result = await toolsFor().search_entries.execute({ query: 'orc' }, {} as any)
    expect(result.entries.map((e: any) => e.id)).toEqual(['e-orc'])
  })

  it('still finds a phrase inside a description', async () => {
    const result = await toolsFor().search_entries.execute({ query: 'ledger' }, {} as any)
    expect(result.entries.map((e: any) => e.id)).toEqual(['e-rec'])
  })

  it('returns whole descriptions', async () => {
    const result = await toolsFor().search_entries.execute({ query: 'orc' }, {} as any)
    expect(result.entries[0].description).toBe('Green folk of the hills.')
  })

  it('has no select_entry tool: entry selection belongs to EntryRetrievalService', async () => {
    // The agent reads lore (search_entries / get_entry) to reason about the past, but no
    // longer returns any. Leaving both able to select put the same entry in the prompt
    // twice and made "who chose this" unanswerable.
    expect(toolsFor().select_entry).toBeUndefined()
  })
})

describe('grep_chapters — sampling', () => {
  const oneChapter = makeContext({
    chapters: [chapter(1, 'Aria everywhere.')],
    // More hits than one search may quote, so the sample is exercised whatever the cap.
    getChapterEntries: () =>
      Array.from({ length: MAX_GREP_EXCERPTS + 8 }, (_, i) => narration(para(`Aria step ${i}.`))),
  })

  it('returns a sample of the excerpts but the complete count', async () => {
    const result = await grepOf(oneChapter)!({ query: 'Aria' })

    expect(result.totalMatches).toBe(MAX_GREP_EXCERPTS + 8)
    expect(result.excerptsShown).toBe(MAX_GREP_EXCERPTS)
    expect(result.sampled).toBe(true)
  })

  it('says nothing about sampling when everything fits', async () => {
    const result = await grepOf(
      makeContext({
        chapters: [chapter(1, 's')],
        getChapterEntries: () => [narration('Aria once.')],
      }),
    )!({ query: 'Aria' })

    expect(result.sampled).toBe(false)
  })

  it('covers the sparse chapters even when one chapter floods the budget', async () => {
    // Sized off the cap rather than hardcoded, so retuning `MAX_GREP_EXCERPTS` cannot make
    // this pass by simply no longer sampling: chapter 1 alone must overflow it.
    const dense: Record<number, StoryEntry[]> = {
      1: Array.from({ length: MAX_GREP_EXCERPTS + 10 }, (_, i) => narration(para(`Aria a${i}.`))),
      2: [narration(para('Aria once in two.'))],
      3: [narration(para('Aria once in three.'))],
    }
    const result = await grepOf(
      makeContext({
        chapters: [chapter(1, 's'), chapter(2, 's'), chapter(3, 's')],
        getChapterEntries: (c) => dense[c.number] ?? [],
      }),
    )!({ query: 'Aria' })

    expect(result.totalMatches).toBe(MAX_GREP_EXCERPTS + 12)
    expect(result.sampled).toBe(true)
    expect(result.excerptsShown).toBe(MAX_GREP_EXCERPTS)

    // Three groups against a much larger budget: coverage is achievable, so the one-mention
    // chapters keep an excerpt each rather than being buried by the dense one.
    const shown = (n: number) =>
      result.excerpts.filter((e: { chapter: number }) => e.chapter === n).length
    expect(shown(2)).toBe(1)
    expect(shown(3)).toBe(1)
    expect(shown(1)).toBe(MAX_GREP_EXCERPTS - 2)
  })
})

describe('inspect_world_state', () => {
  const mockWorldState = {
    characters: [
      {
        id: 'c1',
        name: 'Aria',
        status: 'Active',
        relationship: 'Ally',
        description: 'Brave warrior',
      },
      {
        id: 'c2',
        name: 'Gareth',
        status: 'Missing',
        relationship: 'Rival',
        description: 'Shady rogue',
      },
    ],
    locations: [
      { id: 'l1', name: 'Oakvale', current: true, description: 'Quiet village' },
      { id: 'l2', name: 'Dark Tower', current: false, description: 'Spooky fortress' },
    ],
    items: [{ id: 'i1', name: 'Silver Sword', equipped: true, description: 'Sharp blade' }],
    storyBeats: [
      {
        id: 'b1',
        title: 'Find Gareth',
        status: 'active',
        type: 'quest',
        description: 'Track down Gareth',
      },
    ],
  } as any

  it('is not registered when worldState is unavailable or empty', async () => {
    const tools = createRetrievalTools(makeContext({ worldState: undefined })) as Record<
      string,
      any
    >
    expect(tools.inspect_world_state).toBeUndefined()
  })

  it('filters by category and query when provided', async () => {
    let emittedEvent: any = null
    const tools = createRetrievalTools(
      makeContext({
        worldState: mockWorldState,
        onEvent: (e) => {
          emittedEvent = e
        },
      }),
    ) as Record<string, any>

    const res = await tools.inspect_world_state.execute(
      { category: 'characters', query: 'Gareth' },
      {} as any,
    )

    expect(res.category).toBe('characters')
    expect(res.totalMatched).toBe(1)
    expect(res.totalReturned).toBe(1)
    expect(res.results.characters).toHaveLength(1)
    expect(res.results.characters[0].name).toBe('Gareth')
    expect(emittedEvent).toMatchObject({
      kind: 'world_state',
      category: 'characters',
      query: 'Gareth',
      resultCount: 1,
    })
  })

  it('returns all categories when category is all', async () => {
    const tools = createRetrievalTools(makeContext({ worldState: mockWorldState })) as Record<
      string,
      any
    >
    const res = await tools.inspect_world_state.execute({ category: 'all' }, {} as any)

    expect(res.totalMatched).toBe(6)
    expect(res.results.characters).toHaveLength(2)
    expect(res.results.locations).toHaveLength(2)
    expect(res.results.items).toHaveLength(1)
    expect(res.results.storyBeats).toHaveLength(1)
  })

  it('does not match null or undefined descriptions when a query is provided', async () => {
    const wsWithNull = {
      characters: [
        { id: 'c1', name: 'Unknown Mob', description: null },
        { id: 'c2', name: 'Fire Dragon', description: 'Breathes fire' },
      ],
    } as any

    const tools = createRetrievalTools(makeContext({ worldState: wsWithNull })) as Record<
      string,
      any
    >

    const res = await tools.inspect_world_state.execute(
      { category: 'characters', query: 'dragon' },
      {} as any,
    )

    expect(res.totalMatched).toBe(1)
    expect(res.results.characters[0].name).toBe('Fire Dragon')
  })

  it('respects result limit capping and reports hasMore', async () => {
    const wsMany = {
      characters: Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`,
        name: `Hero ${i}`,
        description: 'Fighter',
      })),
    } as any

    const tools = createRetrievalTools(makeContext({ worldState: wsMany })) as Record<string, any>

    const res = await tools.inspect_world_state.execute(
      { category: 'characters', limit: 5 },
      {} as any,
    )

    expect(res.totalMatched).toBe(25)
    expect(res.totalReturned).toBe(5)
    expect(res.hasMore).toBe(true)
    expect(res.results.characters).toHaveLength(5)
  })

  it('matches on a prefix, so a partly-remembered name still finds the entity', async () => {
    // The argument order is inverted here compared to the injectors: the *query* is the
    // name and the *entity* is the haystack, so `allowPrefix` means "an entity whose name
    // starts with what the agent typed". That is what a search tool should do -- the agent
    // reads the results and judges -- and it is the reason this tool asks for it.
    //
    // This used to return only the exact match, and the test asserted that. It was not the
    // design working: `entityNameMatches` compared the raw haystack in its prefix branch,
    // so a capitalised entity name never matched anything. "Orc" only won because "Orchestra"
    // was silently unreachable, as was "Morvana" for a query of "morv".
    const wsNames = {
      characters: [
        { id: 'c1', name: 'Orc', description: 'Green warrior' },
        { id: 'c2', name: 'Orchestra', description: 'Recorded music' },
        { id: 'c3', name: 'Aria', description: 'Swordswoman' },
      ],
    } as any

    const tools = createRetrievalTools(makeContext({ worldState: wsNames })) as Record<string, any>

    const orc = await tools.inspect_world_state.execute(
      { category: 'characters', query: 'orc' },
      {} as any,
    )
    expect(orc.results.characters.map((c: { name: string }) => c.name)).toEqual([
      'Orc',
      'Orchestra',
    ])

    // The case that was wholly broken: a prefix of a capitalised name, which is how an
    // agent addresses a character it half-remembers.
    const partial = await tools.inspect_world_state.execute(
      { category: 'characters', query: 'ari' },
      {} as any,
    )
    expect(partial.results.characters.map((c: { name: string }) => c.name)).toEqual(['Aria'])
  })

  it('still requires a word boundary, so a prefix is not a substring search', async () => {
    // Prefix, not "appears anywhere": "chestra" must not find "Orchestra".
    const ws = {
      characters: [{ id: 'c1', name: 'Orchestra', description: 'Recorded music' }],
    } as any
    const tools = createRetrievalTools(makeContext({ worldState: ws })) as Record<string, any>

    const res = await tools.inspect_world_state.execute(
      { category: 'characters', query: 'chestra' },
      {} as any,
    )
    expect(res.totalMatched).toBe(0)
  })

  it('includes item location metadata when present', async () => {
    const wsItem = {
      items: [
        { id: 'i1', name: 'Golden Ring', location: 'Chest in Oakvale', description: 'Magic ring' },
      ],
    } as any

    const tools = createRetrievalTools(makeContext({ worldState: wsItem })) as Record<string, any>

    const res = await tools.inspect_world_state.execute({ category: 'items' }, {} as any)

    expect(res.results.items[0].location).toBe('Chest in Oakvale')
  })
})

describe('query_chapter — the whole-chapter read budget', () => {
  function queryOf(overrides = {}) {
    const tools = createRetrievalTools(
      makeContext({
        chapters: [chapter(1, 'a'), chapter(2, 'b'), chapter(3, 'c'), chapter(4, 'd')],
        onQueryChapter: async () => 'an answer',
        ...overrides,
      }),
    ) as Record<string, any>
    return (chapterNumber: number) =>
      tools.query_chapter.execute({ chapterNumber, question: 'what happened?' }, {} as any)
  }

  it('answers up to the budget', async () => {
    const query = queryOf()
    for (let i = 0; i < MAX_CHAPTER_QUERIES; i++) {
      expect((await query(1)).answered).toBe(true)
    }
  })

  it('refuses past it, and points at the tool that can still answer', async () => {
    // Nothing bounded this before: maxQueries is the static path's, and maxIterations
    // counts steps. A run could spend every step on a ~17,000-token chapter read.
    const query = queryOf()
    for (let i = 0; i < MAX_CHAPTER_QUERIES; i++) await query(1)

    const refused = await query(2)
    expect(refused.answered).toBe(false)
    expect(refused.error).toContain('grep_chapters')
  })

  it('reads the same whichever chapter is asked for once spent', async () => {
    const query = queryOf()
    for (let i = 0; i < MAX_CHAPTER_QUERIES; i++) await query(1)

    // Including a chapter that does not exist: the budget answer must not be mistaken for
    // "that chapter is missing".
    expect((await query(99)).error).toContain('grep_chapters')
  })

  it('does not spend budget on a chapter that does not exist', async () => {
    const query = queryOf()
    expect((await query(99)).error).toContain('does not exist')
    // The failed lookup was free, so all the reads are still available.
    for (let i = 0; i < MAX_CHAPTER_QUERIES; i++) {
      expect((await query(1)).answered).toBe(true)
    }
  })
})
