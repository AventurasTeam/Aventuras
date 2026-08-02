import { describe, expect, it } from 'vitest'

import { readerPillPhase } from './generation-phase'

describe('readerPillPhase', () => {
  it('gives the blocking retrieval phase its own label instead of the narrative one', () => {
    expect(readerPillPhase({ turnPhase: 'retrieval', refreshingSuggestions: false })).toBe(
      'recalling-memory',
    )
  })

  it('labels the narrative phase as narrative generation', () => {
    expect(readerPillPhase({ turnPhase: 'narrative', refreshingSuggestions: false })).toBe(
      'generating-narrative',
    )
  })

  it('labels the fallback classifier as classifying', () => {
    expect(
      readerPillPhase({ turnPhase: 'piggyback-fallback-classifier', refreshingSuggestions: false }),
    ).toBe('classifying')
  })

  it('keeps the pre-retrieval label over the turn opening translation phase', () => {
    expect(
      readerPillPhase({ turnPhase: 'user-action-translation', refreshingSuggestions: false }),
    ).toBe('generating-narrative')
  })

  it('labels the window before phase 0 names itself', () => {
    expect(readerPillPhase({ turnPhase: '', refreshingSuggestions: false })).toBe(
      'generating-narrative',
    )
  })

  it('falls back rather than blanking the pill on an unmapped phase name', () => {
    expect(readerPillPhase({ turnPhase: 'chapter-metadata', refreshingSuggestions: false })).toBe(
      'generating-narrative',
    )
  })

  it('reports a suggestion refresh when no turn is running', () => {
    expect(readerPillPhase({ turnPhase: null, refreshingSuggestions: true })).toBe(
      'refreshing-suggestions',
    )
  })

  // A turn aborts an in-flight refresh and both runs can sit in txState across
  // that handoff; the turn owns the pill, and the pill must never go empty
  // while either runs (the memory error would take the slot).
  it('lets a running turn win over a refresh', () => {
    expect(readerPillPhase({ turnPhase: 'retrieval', refreshingSuggestions: true })).toBe(
      'recalling-memory',
    )
  })

  it('hides when neither a turn nor a refresh is running', () => {
    expect(readerPillPhase({ turnPhase: null, refreshingSuggestions: false })).toBeUndefined()
  })
})
