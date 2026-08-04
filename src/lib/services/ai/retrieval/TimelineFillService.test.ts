import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Chapter, StoryEntry } from '$lib/types'

vi.mock('$lib/stores/debug.svelte', () => ({
  debug: {
    addDebugRequest: vi.fn(),
    addDebugResponse: vi.fn(),
  },
}))

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    systemServicesSettings: {
      timelineFill: {
        maxQueries: 3,
      },
    },
    getServicePresetId: vi.fn(() => 'memory'),
    getServiceIdForPreset: vi.fn(),
    getServiceConfig: vi.fn(),
  },
}))

const generateStructured = vi.fn()
const generatePlainText = vi.fn()
vi.mock('../sdk/generate', () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
  generatePlainText: (...args: unknown[]) => generatePlainText(...args),
}))

// ContextBuilder reaches the pack store and the database; the prompt text is not what these
// tests are about, but `chapterContent` is — so it is captured on the way through.
const rendered: Record<string, string>[] = []
vi.mock('$lib/services/context', () => ({
  ContextBuilder: class {
    private vars: Record<string, string> = {}
    add(vars: Record<string, string>) {
      Object.assign(this.vars, vars)
      rendered.push(vars)
    }
    async render() {
      return { system: 'system', user: 'user' }
    }
  },
}))

import { TimelineFillService } from './TimelineFillService'

const mockEntries: StoryEntry[] = [
  { id: 'se-1', content: 'She looked up at the fortress.', type: 'narration' } as StoryEntry,
]

function chapter(number: number, summary = `Summary of chapter ${number}.`): Chapter {
  return { id: `ch-${number}`, number, title: '', summary } as Chapter
}

/** Entries big enough that two chapters cannot both fit in the budgets used below. */
function fatEntries(chapterNumber: number): StoryEntry[] {
  return [
    {
      id: `e-${chapterNumber}`,
      type: 'narration',
      content: `VERBATIM-${chapterNumber} ` + 'word '.repeat(4000),
    } as StoryEntry,
  ]
}

beforeEach(() => {
  generateStructured.mockReset()
  generatePlainText.mockReset()
  rendered.length = 0
})

describe('TimelineFillService', () => {
  it('can be instantiated with service configuration', () => {
    expect(new TimelineFillService('timelineFill', 3)).toBeDefined()
  })

  it('returns empty queries if no chapters exist', async () => {
    const queries = await new TimelineFillService('timelineFill', 3).generateQueries(
      mockEntries,
      [],
    )
    expect(queries).toEqual([])
  })
})

describe('runTimelineFill - unanswered questions', () => {
  it('drops a question whose answer call failed, instead of forwarding the give-up string', async () => {
    const service = new TimelineFillService('timelineFill', 3)
    generateStructured.mockResolvedValue({
      queries: [
        { query: 'What happened to the ring?', chapters: [1] },
        { query: 'Who was at the gate?', chapters: [2] },
      ],
    })
    generatePlainText
      .mockRejectedValueOnce(new Error('context overflow'))
      .mockResolvedValueOnce('Sera was at the gate.')

    const result = await service.runTimelineFill(mockEntries, [chapter(1), chapter(2)])

    expect(result.queries).toHaveLength(2)
    expect(result.responses).toHaveLength(1)
    expect(result.responses[0].query).toBe('Who was at the gate?')
    expect(JSON.stringify(result.responses)).not.toContain('Unable to answer')
  })

  it('drops a question that resolved to no chapters at all', async () => {
    const service = new TimelineFillService('timelineFill', 3)
    generateStructured.mockResolvedValue({
      queries: [{ query: 'What happened in chapter 99?', chapters: [99] }],
    })

    const result = await service.runTimelineFill(mockEntries, [chapter(1)])

    expect(result.responses).toEqual([])
    expect(generatePlainText).not.toHaveBeenCalled()
  })
})

describe('runTimelineFill - chapter text budget', () => {
  async function contentFor(maxChapterTokens: number, chapters: number[]) {
    const service = new TimelineFillService('timelineFill', 3)
    generateStructured.mockResolvedValue({
      queries: [{ query: 'What happened?', chapters }],
    })
    generatePlainText.mockResolvedValue('An answer.')

    await service.runTimelineFill(
      mockEntries,
      chapters.map((n) => chapter(n)),
      (c) => fatEntries(c.number),
      undefined,
      maxChapterTokens,
    )

    return rendered.find((v) => 'chapterContent' in v)?.chapterContent ?? ''
  }

  it('sends every requested chapter verbatim when the budget allows', async () => {
    const content = await contentFor(500_000, [1, 2])

    expect(content).toContain('VERBATIM-1')
    expect(content).toContain('VERBATIM-2')
    expect(content).not.toContain('TRUNCATED')
  })

  it('truncates instead of splitting: still one call, and it says what was cut', async () => {
    const content = await contentFor(6_000, [1, 2])

    expect(content).toContain('VERBATIM-1')
    expect(content).not.toContain('VERBATIM-2')
    expect(content).toContain('TRUNCATED')
    expect(content).toContain('Chapter 2 not included at all')
    // One prompt, not one per chapter -- query_chapter is never multiplied.
    expect(rendered.filter((v) => 'chapterContent' in v)).toHaveLength(1)
  })

  it('names every chapter that got no text, however wide the query', async () => {
    const content = await contentFor(6_000, [1, 2, 3, 4])

    expect(content).toContain('Chapters 2, 3, 4 not included at all')
    expect(rendered.filter((v) => 'chapterContent' in v)).toHaveLength(1)
  })

  it('uses stored token counts rather than tokenizing the text', async () => {
    const service = new TimelineFillService('timelineFill', 3)
    generateStructured.mockResolvedValue({ queries: [{ query: 'What?', chapters: [1] }] })
    generatePlainText.mockResolvedValue('An answer.')

    // metadata.tokenCount says 10; the text is far longer. If the budget of 20 is respected
    // both entries survive, which only holds if the stored count was the one consulted.
    const cheap = (c: Chapter): StoryEntry[] =>
      [0, 1].map(
        (i) =>
          ({
            id: `e-${c.number}-${i}`,
            type: 'narration',
            content: `CHEAP-${i} ` + 'word '.repeat(4000),
            metadata: { tokenCount: 10 },
          }) as unknown as StoryEntry,
      )

    await service.runTimelineFill(mockEntries, [chapter(1)], cheap, undefined, 20)

    const content = rendered.find((v) => 'chapterContent' in v)?.chapterContent ?? ''
    expect(content).toContain('CHEAP-0')
    expect(content).toContain('CHEAP-1')
    expect(content).not.toContain('TRUNCATED')
  })
})

describe('runTimelineFill - subset grouping', () => {
  it("answers a narrow question from the wide group's chapters instead of reassembling them", async () => {
    const service = new TimelineFillService('timelineFill', 3)
    generateStructured
      .mockResolvedValueOnce({
        queries: [
          { query: 'Wide question?', chapters: [1, 2, 3] },
          { query: 'Narrow question?', chapters: [2] },
        ],
      })
      .mockResolvedValue({
        answers: [
          { index: 0, answer: 'Wide answer.' },
          { index: 1, answer: 'Narrow answer.' },
        ],
      })

    const result = await service.runTimelineFill(
      mockEntries,
      [chapter(1), chapter(2), chapter(3)],
      (c) => fatEntries(c.number),
    )

    // One assembled content, one batched call -- not two separate chapter renders.
    const answerPrompts = rendered.filter((v) => 'chapterContent' in v)
    expect(answerPrompts).toHaveLength(1)
    expect(result.responses.map((r) => r.query)).toEqual(['Wide question?', 'Narrow question?'])
    // The narrow question keeps its own chapter list in the result.
    expect(result.responses[1].chapterNumbers).toEqual([2])
  })

  it('does not fold a narrow question into a wide group the budget will truncate', async () => {
    const service = new TimelineFillService('timelineFill', 3)
    generateStructured
      .mockResolvedValueOnce({
        queries: [
          { query: 'Wide question?', chapters: [1, 2, 3] },
          { query: 'Narrow question?', chapters: [3] },
        ],
      })
      // A usable batch answer, so a fold produces exactly one assembled content and the
      // assertion below cannot pass by way of the incomplete-batch retry path.
      .mockResolvedValue({
        answers: [
          { index: 0, answer: 'Wide answer.' },
          { index: 1, answer: 'Narrow answer.' },
        ],
      })
    generatePlainText.mockResolvedValue('An answer.')

    // Each chapter is ~4,006 tokens, so {1,2,3} cannot fit in 6,000 and is cut from chapter
    // 3 down -- exactly the chapter the narrow question is about. {3} alone fits. Folded,
    // the narrow question would be answered from a text that stops inside chapter 1.
    await service.runTimelineFill(
      mockEntries,
      [chapter(1), chapter(2), chapter(3)],
      (c) => fatEntries(c.number),
      undefined,
      6_000,
    )

    const contents = rendered
      .filter((v) => 'chapterContent' in v)
      .map((v) => v.chapterContent as string)

    // The narrow question got chapter 3's real text, which the wide group never contained.
    expect(contents.some((c) => c.includes('VERBATIM-3'))).toBe(true)
    expect(contents).toHaveLength(2)
  })

  it('does not merge sets that merely overlap', async () => {
    const service = new TimelineFillService('timelineFill', 3)
    generateStructured.mockResolvedValueOnce({
      queries: [
        { query: 'A?', chapters: [1, 2] },
        { query: 'B?', chapters: [2, 3] },
      ],
    })
    generatePlainText.mockResolvedValue('An answer.')

    await service.runTimelineFill(mockEntries, [chapter(1), chapter(2), chapter(3)], (c) =>
      fatEntries(c.number),
    )

    // Neither is a subset of the other, so they stay separate rather than both paying for
    // a widened three-chapter render.
    expect(rendered.filter((v) => 'chapterContent' in v)).toHaveLength(2)
  })
})
