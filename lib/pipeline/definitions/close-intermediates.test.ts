import { describe, expect, it } from 'vitest'

import type { ChapterPartCut } from '@/lib/chapters'

import {
  closeClustersOf,
  closeLedgerOf,
  closePartsOf,
  closeRangeOf,
  requireCloseParts,
  requireCloseRange,
  seedCloseLedger,
  setCloseClusters,
  setCloseParts,
  setCloseRange,
} from './close-intermediates'
import type { CloseRange } from './intermediates'

const RANGE: CloseRange = { chapterId: 'chap_new', startEntryId: 'e1', endEntryId: 'e7' }

describe('the close range', () => {
  it('reads back the range parked on the record, and only under its own key', () => {
    const intermediates: Record<string, unknown> = {}
    expect(closeRangeOf(intermediates)).toBeUndefined()

    setCloseRange(intermediates, RANGE)

    expect(closeRangeOf(intermediates)).toBe(RANGE)
    expect(requireCloseRange({ intermediates })).toBe(RANGE)
    expect(closeLedgerOf(intermediates)).toBeUndefined()
    expect(closePartsOf(intermediates)).toBeUndefined()
  })

  it('gives the failure a close phase returns when no range is parked', () => {
    expect(requireCloseRange({ intermediates: {} })).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    })
  })
})

describe('the close ledger', () => {
  it('is absent until seeded, then seeded empty with no tool call yet', () => {
    const intermediates: Record<string, unknown> = {}
    expect(closeLedgerOf(intermediates)).toBeUndefined()

    expect(seedCloseLedger(intermediates)).toEqual({ calls: [], stopped: [], noToolCalls: true })
    expect(closeRangeOf(intermediates)).toBeUndefined()
  })

  it('seeds once: a later call returns the live ledger with the writes made through it', () => {
    const intermediates: Record<string, unknown> = {}
    const ledger = seedCloseLedger(intermediates)
    ledger.stopped.push({ task: 'lore', part: 1, reason: 'budget' })
    ledger.noToolCalls = false

    expect(seedCloseLedger(intermediates)).toBe(ledger)
    expect(closeLedgerOf(intermediates)).toEqual({
      calls: [],
      stopped: [{ task: 'lore', part: 1, reason: 'budget' }],
      noToolCalls: false,
    })
  })
})

describe('the close parts', () => {
  const PARTS: readonly ChapterPartCut[] = [
    { part: 1, startEntryId: 'e1', endEntryId: 'e4', tokens: 12_000 },
    { part: 2, startEntryId: 'e5', endEntryId: 'e7', tokens: 9_000 },
  ]

  it('reads back the parts parked on the record, and only under their own key', () => {
    const intermediates: Record<string, unknown> = {}
    expect(closePartsOf(intermediates)).toBeUndefined()

    setCloseParts(intermediates, PARTS)

    expect(closePartsOf(intermediates)).toBe(PARTS)
    expect(requireCloseParts({ intermediates })).toBe(PARTS)
    expect(closeRangeOf(intermediates)).toBeUndefined()
    expect(closeLedgerOf(intermediates)).toBeUndefined()
  })

  it('gives the failure the agent phase returns when no parts are parked', () => {
    expect(requireCloseParts({ intermediates: {} })).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close parts' },
    })
  })
})

describe('the close clusters', () => {
  it('reads none until the range embed parks them, then those, under their own key', () => {
    const intermediates: Record<string, unknown> = {}
    expect(closeClustersOf(intermediates)).toEqual([])

    setCloseClusters(intermediates, [
      ['hap_a', 'hap_b'],
      ['hap_c', 'hap_d', 'hap_e'],
    ])

    expect(closeClustersOf(intermediates)).toEqual([
      ['hap_a', 'hap_b'],
      ['hap_c', 'hap_d', 'hap_e'],
    ])
    expect(closeRangeOf(intermediates)).toBeUndefined()
    expect(closePartsOf(intermediates)).toBeUndefined()
    expect(closeLedgerOf(intermediates)).toBeUndefined()
  })
})
