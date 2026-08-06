import { describe, expect, it } from 'vitest'

import { readerPillPhase } from './generation-phase'

const IDLE = { turnPhase: null, refreshingSuggestions: false, classifierRunning: false }

describe('readerPillPhase', () => {
  it('gives the blocking retrieval phase its own label instead of the narrative one', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: 'retrieval' })).toBe('recalling-memory')
  })

  it('labels the narrative phase as narrative generation', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: 'narrative' })).toBe('generating-narrative')
  })

  it('labels the fallback classifier as classifying', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: 'piggyback-fallback-classifier' })).toBe(
      'classifying',
    )
  })

  it('keeps the pre-retrieval label over the turn opening translation phase', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: 'user-action-translation' })).toBe(
      'generating-narrative',
    )
  })

  it('labels the window before phase 0 names itself', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: '' })).toBe('generating-narrative')
  })

  it('falls back rather than blanking the pill on an unmapped phase name', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: 'chapter-metadata' })).toBe('generating-narrative')
  })

  it('reports a suggestion refresh when no turn is running', () => {
    expect(readerPillPhase({ ...IDLE, refreshingSuggestions: true })).toBe('refreshing-suggestions')
  })

  // The periodic classifier is a background run, so it never reaches turnPhase
  // and would otherwise leave the pill empty for the length of the pass.
  it('reports the periodic classifier when no turn or refresh is running', () => {
    expect(readerPillPhase({ ...IDLE, classifierRunning: true })).toBe('updating-memory')
  })

  // Both run the classifier, but only the in-turn one blocks the composer, and
  // the pill's tone and cancel affordance key off the distinction.
  it('separates the background pass from the blocking in-turn fallback', () => {
    expect(readerPillPhase({ ...IDLE, classifierRunning: true })).not.toBe(
      readerPillPhase({ ...IDLE, turnPhase: 'piggyback-fallback-classifier' }),
    )
  })

  // A turn aborts an in-flight refresh and both runs can sit in txState across
  // that handoff; the turn owns the pill, and the pill must never go empty
  // while either runs (the memory error would take the slot).
  it('lets a running turn win over a refresh', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: 'retrieval', refreshingSuggestions: true })).toBe(
      'recalling-memory',
    )
  })

  // The classifier runs concurrently with a turn by design, so both flags are
  // set for most of a pass; the foreground phase is the one worth naming.
  it('lets a running turn win over the periodic classifier', () => {
    expect(readerPillPhase({ ...IDLE, turnPhase: 'retrieval', classifierRunning: true })).toBe(
      'recalling-memory',
    )
  })

  it('lets a refresh win over the periodic classifier', () => {
    expect(readerPillPhase({ ...IDLE, refreshingSuggestions: true, classifierRunning: true })).toBe(
      'refreshing-suggestions',
    )
  })

  it('hides when nothing is running', () => {
    expect(readerPillPhase(IDLE)).toBeUndefined()
  })
})
