import { describe, it, expect } from 'vitest'
import {
  formatRetrievalHistory,
  retrievalMetrics,
  summarizeProgress,
  type RetrievalEvent,
  type RetrievalEventInput,
} from './retrievalHistory'

/** Stamp `at` in order, the way the service does. */
function log(...events: RetrievalEventInput[]): RetrievalEvent[] {
  return events.map((e, at) => ({ ...e, at }) as RetrievalEvent)
}

const grep = (query: string, over: Partial<Extract<RetrievalEvent, { kind: 'grep' }>> = {}) =>
  ({
    kind: 'grep',
    query,
    chapters: null,
    wholeWord: false,
    totalMatches: 3,
    excerptsShown: 3,
    sampled: false,
    repeated: false,
    ...over,
  }) as RetrievalEventInput

const query = (chapterNumber: number, question: string, cached = false) =>
  ({
    kind: 'query',
    chapterNumber,
    question,
    answer: 'Aria took the key from the table.',
    cached,
  }) as RetrievalEventInput

describe('summarizeProgress', () => {
  it('says so when nothing has happened', () => {
    expect(summarizeProgress([])).toBe('Nothing done yet.')
  })

  it('lists what has already been searched and queried', () => {
    const line = summarizeProgress(log(grep('black tower'), query(3, 'who held the key?')), {
      steps: 2,
      maxIterations: 30,
    })

    expect(line).toContain('grepped: "black tower"')
    expect(line).toContain('already queried: ch.3')
    expect(line).toContain('step 2/30')
  })

  it('quotes the step count it was given, not the number of events', () => {
    // Two tool calls inside a single step. Reporting "step 2" here would tell the agent
    // it has burned twice the budget it actually has.
    const line = summarizeProgress(log(grep('a'), grep('b')), { steps: 1, maxIterations: 20 })

    expect(line).toContain('step 1/20')
    expect(line).not.toContain('step 2')
  })

  it('stays on one line', () => {
    const line = summarizeProgress(log(grep('a'), grep('b'), query(1, 'who held the key?')))
    expect(line).not.toContain('\n')
  })

  it('does not repeat a term searched twice', () => {
    const line = summarizeProgress(log(grep('tower'), grep('tower', { repeated: true })))
    expect(line).toBe('grepped: "tower" · tool calls: 2')
  })

  it('keeps grep terms apart from lorebook search terms', () => {
    // Both used to land in one "already searched" list, so a word greppped through the
    // story text read as though the lorebook had been searched for it too. They answer
    // different questions, and re-running the other one is often the right next step.
    const line = summarizeProgress(
      log(grep('tower'), { kind: 'search', query: 'tower', resultCount: 2 }),
    )

    expect(line).toContain('grepped: "tower"')
    expect(line).toContain('searched entries: "tower"')
  })

  it('caps the term list and says how many were dropped', () => {
    const line = summarizeProgress(
      log(...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((q) => grep(q))),
    )

    expect(line).toContain('(+2 more)')
    expect(line).not.toContain('"a"')
    expect(line).toContain('"h"')
  })

  it('summarizes inspected world state separately from searched queries', () => {
    const worldStateEvent: RetrievalEventInput = {
      kind: 'world_state',
      category: 'characters',
      query: 'Aria',
      resultCount: 1,
    }
    const line = summarizeProgress(log(worldStateEvent))
    expect(line).toContain('inspected world state: "Aria"')
    expect(line).not.toContain('grepped:')
    expect(line).not.toContain('searched entries:')
  })
})

describe('formatRetrievalHistory', () => {
  it('handles an empty run', () => {
    expect(formatRetrievalHistory([])).toBe('Retrieval · nothing recorded')
  })

  it('renders a header and one line per event', () => {
    const text = formatRetrievalHistory(
      log(
        grep('black tower', { totalMatches: 12, excerptsShown: 12 }),
        query(3, 'who held the key?'),
        { kind: 'finish', confidence: 'high', hasSummary: true },
      ),
    )

    expect(text.split('\n')).toHaveLength(4)
    expect(text).toContain('Retrieval · 3 tool calls · 1 LLM call · 1 grep')
    expect(text).toContain('grep "black tower" (everywhere)  12 matches · showed 12')
    expect(text).toContain('query ch.3')
    expect(text).toContain('finish  confidence: high')
  })

  it('marks a grep that found nothing', () => {
    const text = formatRetrievalHistory(log(grep('unicorn', { totalMatches: 0, excerptsShown: 0 })))
    expect(text).toContain('no matches')
  })

  it('marks repeats, cached queries and a missing chapter summary', () => {
    const text = formatRetrievalHistory(
      log(grep('tower', { repeated: true }), query(3, 'again?', true), {
        kind: 'finish',
        confidence: 'low',
        hasSummary: false,
      }),
    )

    expect(text).toContain('[repeat]')
    expect(text).toContain('[cached]')
    expect(text).toContain('(no chapter summary!)')
  })

  it('shows the scope of a narrowed grep', () => {
    const text = formatRetrievalHistory(log(grep('key', { chapters: [3, 7], wholeWord: true })))
    expect(text).toContain('(ch.3, ch.7, whole-word)')
  })

  it('marks a sampled grep, so a partial view is not read as the whole picture', () => {
    const text = formatRetrievalHistory(
      log(grep('key', { totalMatches: 80, excerptsShown: 20, sampled: true })),
    )
    expect(text).toContain('80 matches · showed 20 (sampled)')
  })

  it('formats world_state event lines correctly', () => {
    const text = formatRetrievalHistory(
      log({
        kind: 'world_state',
        category: 'characters',
        query: 'Aria',
        resultCount: 2,
      }),
    )
    expect(text).toContain('inspect_world_state category=characters query="Aria"  2 entities')
  })
})

describe('retrievalMetrics', () => {
  it('counts an empty run as zero, not as a finished one', () => {
    const m = retrievalMetrics([])
    expect(m.toolCalls).toBe(0)
    expect(m.finished).toBe(false)
    expect(m.grepToQueryRatio).toBeNull()
  })

  it('excludes cached queries from LLM calls', () => {
    const m = retrievalMetrics(log(query(1, 'a'), query(1, 'a', true), query(2, 'b')))

    expect(m.llmCalls).toBe(2)
    expect(m.cachedQueries).toBe(1)
  })

  it('measures grep-first behaviour', () => {
    const m = retrievalMetrics(log(grep('a'), grep('b'), query(3, 'x'), grep('c')))

    expect(m.greps).toBe(3)
    expect(m.grepsBeforeFirstQuery).toBe(2)
    expect(m.grepToQueryRatio).toBe(3)
  })

  it('counts repeated greps separately', () => {
    const m = retrievalMetrics(log(grep('a'), grep('a', { repeated: true })))
    expect(m.greps).toBe(2)
    expect(m.repeatedGreps).toBe(1)
  })

  it('reports whether the agent actually finished', () => {
    expect(retrievalMetrics(log(grep('a'))).finished).toBe(false)
    expect(
      retrievalMetrics(log(grep('a'), { kind: 'finish', confidence: 'high', hasSummary: true }))
        .finished,
    ).toBe(true)
  })
})
