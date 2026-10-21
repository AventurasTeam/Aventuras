import { describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'

import { readerPillPhase } from './generation-phase'

const IDLE = {
  turnKind: null,
  turnPhase: null,
  refreshingSuggestions: false,
}
const TURN = { ...IDLE, turnKind: 'per-turn' }
const PASS = { ...IDLE, turnKind: PERIODIC_CLASSIFIER_KIND }

describe('readerPillPhase', () => {
  it('gives the blocking retrieval phase its own label instead of the narrative one', () => {
    expect(readerPillPhase({ ...TURN, turnPhase: 'retrieval' })).toBe('recalling-memory')
  })

  // The per-turn phase map covers only that pipeline: without a kind check, chapter-close borrows
  // its labels and disagrees with the same run's label in Story Settings.
  it('labels a chapter-close run by kind rather than borrowing a per-turn label', () => {
    expect(
      readerPillPhase({ ...IDLE, turnKind: 'chapter-close', turnPhase: 'chapter-metadata' }),
    ).toBe('closing-chapter')
  })

  it('labels the narrative phase as narrative generation', () => {
    expect(readerPillPhase({ ...TURN, turnPhase: 'narrative' })).toBe('generating-narrative')
  })

  it('labels the fallback classifier as classifying', () => {
    expect(readerPillPhase({ ...TURN, turnPhase: 'piggyback-fallback-classifier' })).toBe(
      'classifying',
    )
  })

  it('keeps the pre-retrieval label over the turn opening translation phase', () => {
    expect(readerPillPhase({ ...TURN, turnPhase: 'user-action-translation' })).toBe(
      'generating-narrative',
    )
  })

  it('labels the window before phase 0 names itself', () => {
    expect(readerPillPhase({ ...TURN, turnPhase: '' })).toBe('generating-narrative')
  })

  it('falls back rather than blanking the pill on an unmapped phase name', () => {
    expect(readerPillPhase({ ...TURN, turnPhase: 'some-future-phase' })).toBe(
      'generating-narrative',
    )
  })

  it('reports a suggestion refresh when no turn is running', () => {
    expect(readerPillPhase({ ...IDLE, refreshingSuggestions: true })).toBe('refreshing-suggestions')
  })

  // A pass reaches the pill as the branch's run, so its kind names it whatever its phase.
  it('labels a pass by its kind, before and after its phase names itself', () => {
    expect(readerPillPhase({ ...PASS, turnPhase: '' })).toBe('updating-memory')
    expect(readerPillPhase({ ...PASS, turnPhase: 'classify' })).toBe('updating-memory')
  })

  // Both run the classifier: one is the turn's own work, the other the pass chained after it.
  it('separates the pass from the in-turn fallback', () => {
    expect(readerPillPhase({ ...PASS, turnPhase: 'classify' })).not.toBe(
      readerPillPhase({ ...TURN, turnPhase: 'piggyback-fallback-classifier' }),
    )
  })

  // generation-pipeline.md → Pill currentPhase: a pass owns the pill over a refresh beside it.
  it('lets a pass win over a refresh running beside it', () => {
    expect(readerPillPhase({ ...PASS, turnPhase: 'classify', refreshingSuggestions: true })).toBe(
      'updating-memory',
    )
  })

  // A turn aborts an in-flight refresh and both runs can sit in txState across
  // that handoff; the turn owns the pill, and the pill must never go empty
  // while either runs (the memory error would take the slot).
  it('lets a running turn win over a refresh', () => {
    expect(readerPillPhase({ ...TURN, turnPhase: 'retrieval', refreshingSuggestions: true })).toBe(
      'recalling-memory',
    )
  })

  it('hides when nothing is running', () => {
    expect(readerPillPhase(IDLE)).toBeUndefined()
  })
})
