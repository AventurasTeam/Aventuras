import { describe, it, expect } from 'vitest'
import { retrievalStep, retrievalStepStatus } from './retrievalSteps'
import type { RetrievalEvent } from './retrievalHistory'

describe('retrievalStep', () => {
  it('labels a grep by its term and reports its scope and yield', () => {
    const step = retrievalStep({
      at: 0,
      kind: 'grep',
      query: 'Kaelen',
      chapters: [12],
      wholeWord: false,
      caseSensitive: false,
      totalMatches: 9,
      excerptsShown: 4,
      sampled: true,
      repeated: false,
    })

    expect(step.label).toBe('grep "Kaelen"')
    expect(step.options.detail).toBe('ch.12 · 4 of 9 matches')
    expect(step.options.isLLM).toBeFalsy()
  })

  it('says when a grep covered every chapter and was repeated', () => {
    const step = retrievalStep({
      at: 0,
      kind: 'grep',
      query: 'temple',
      chapters: null,
      wholeWord: false,
      caseSensitive: false,
      totalMatches: 2,
      excerptsShown: 2,
      sampled: false,
      repeated: true,
    })

    expect(step.options.detail).toBe('all chapters · 2 matches · repeated')
  })

  it('marks a chapter query as an LLM step and carries its measured duration', () => {
    const step = retrievalStep({
      at: 1,
      kind: 'query',
      chapterNumber: 12,
      question: 'What happened to the seal?',
      answer: '...',
      cached: false,
      durationMs: 6_200,
    })

    expect(step.label).toBe('query ch.12')
    expect(step.options.isLLM).toBe(true)
    expect(step.options.durationMs).toBe(6_200)
    expect(step.options.detail).toBe('What happened to the seal?')
  })

  it('does not count a cached chapter answer as a model call', () => {
    const step = retrievalStep({
      at: 1,
      kind: 'query',
      chapterNumber: 4,
      question: 'q',
      answer: 'a',
      cached: true,
      durationMs: 0,
    })

    expect(step.options.isLLM).toBe(false)
    expect(step.options.detail).toBe('cached')
  })

  it('reports a failed chapter query as failed and not as a model call', () => {
    const event: RetrievalEvent = {
      at: 1,
      kind: 'query',
      chapterNumber: 4,
      question: 'q',
      answer: 'boom',
      cached: false,
      failed: true,
    }

    expect(retrievalStep(event).options.isLLM).toBe(false)
    expect(retrievalStepStatus(event)).toBe('failed')
  })

  it('labels an entry search by its query and result count', () => {
    const step = retrievalStep({ at: 2, kind: 'search', query: 'temple', resultCount: 3 })

    expect(step.label).toBe('search "temple"')
    expect(step.options.detail).toBe('3 found')
  })

  it('labels a world state inspection', () => {
    const step = retrievalStep({
      at: 3,
      kind: 'world_state',
      query: 'Kaelen',
      category: 'characters',
      resultCount: 1,
    })

    expect(step.label).toBe('world state "Kaelen"')
    expect(step.options.detail).toBe('1 found · characters')
  })

  it('labels an entry read and says when it was not found', () => {
    expect(retrievalStep({ at: 4, kind: 'entry', name: 'Seal', found: true }).label).toBe(
      'read Seal',
    )
    expect(
      retrievalStep({ at: 4, kind: 'entry', entryId: 'e1', found: false }).options.detail,
    ).toBe('not found')
  })

  it('labels the terminal step with its confidence', () => {
    const step = retrievalStep({ at: 5, kind: 'finish', confidence: 'medium', hasSummary: true })

    expect(step.label).toBe('finish')
    expect(step.options.detail).toBe('confidence: medium')
  })

  it('notes a terminal step that produced no summary', () => {
    const step = retrievalStep({ at: 5, kind: 'finish', confidence: 'low', hasSummary: false })

    expect(step.options.detail).toBe('confidence: low · no summary')
  })
})
