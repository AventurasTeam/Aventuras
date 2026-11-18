import { describe, expect, it, vi } from 'vitest'

import type { StoryEntry } from '@/lib/db'

import { canEndChapter } from './can-end-chapter'
import { closeCandidates, closeCandidateWindow } from './close-candidates'

// Passes through to the real rule; the C10 case swaps it, to prove the candidates ask it.
vi.mock('./can-end-chapter', async (importOriginal) => {
  const actual = await importOriginal<{ canEndChapter: typeof canEndChapter }>()
  return { canEndChapter: vi.fn(actual.canEndChapter) }
})

type Row = { id: string; kind: StoryEntry['kind']; tokens: number }

const row = (id: string, kind: StoryEntry['kind'], tokens: number): Row => ({ id, kind, tokens })
const opening = (tokens: number): Row => row('o1', 'opening', tokens)
const u = (n: number, tokens: number): Row => row(`u${n}`, 'user_action', tokens)
const r = (n: number, tokens: number): Row => row(`r${n}`, 'ai_reply', tokens)

const ids = (rows: readonly { id: string }[]): string[] => rows.map((x) => x.id)

// chapter-close.md → Phase 1. At a threshold of 1000 the window is 500 to 1500 tokens through.
describe('closeCandidates', () => {
  it('keeps each reply from half a threshold to one and a half, both inclusive, with its total', () => {
    // Running totals: 200, 300, 500, 600, 1000, 1100, 1500, 1600, 1900.
    const series = [
      opening(200),
      u(1, 100),
      r(1, 200),
      u(2, 100),
      r(2, 400),
      u(3, 100),
      r(3, 400),
      u(4, 100),
      r(4, 300),
    ]
    expect(closeCandidates(series, 1000)).toEqual([
      { id: 'r1', kind: 'ai_reply', tokens: 200, tokensThrough: 500 },
      { id: 'r2', kind: 'ai_reply', tokens: 400, tokensThrough: 1000 },
      { id: 'r3', kind: 'ai_reply', tokens: 400, tokensThrough: 1500 },
    ])
  })

  it('leaves out a reply one token under half a threshold, or one over one and a half', () => {
    // Running totals: 199, 299, 499, 599, 999, 1099, 1501, 1601, 1901.
    const series = [
      opening(199),
      u(1, 100),
      r(1, 200),
      u(2, 100),
      r(2, 400),
      u(3, 100),
      r(3, 402),
      u(4, 100),
      r(4, 300),
    ]
    expect(closeCandidates(series, 1000)).toEqual([
      { id: 'r2', kind: 'ai_reply', tokens: 400, tokensThrough: 999 },
    ])
  })

  it('never keeps the newest reply, though its total sits in the window', () => {
    // Running totals: 100, 200, 500, 600, 1000.
    const series = [opening(100), u(1, 100), r(1, 300), u(2, 100), r(2, 400)]
    expect(ids(closeCandidates(series, 1000))).toEqual(['r1'])
  })

  it('never keeps the newest reply under a tail of user actions', () => {
    // Running totals: 100, 200, 1000, 1100, 1200.
    const series = [opening(100), u(1, 100), r(1, 800), u(2, 100), u(3, 100)]
    expect(closeCandidates(series, 1000)).toEqual([])
  })

  it('keeps no opening, user_action or system row, though its total sits in the window', () => {
    // Running totals: 600, 700, 800, 900, 950, 1050.
    const series = [
      opening(600),
      row('s1', 'system', 100),
      u(1, 100),
      r(1, 100),
      u(2, 50),
      r(2, 100),
    ]
    expect(ids(closeCandidates(series, 1000))).toEqual(['r1'])
  })

  it('returns nothing for an empty region', () => {
    expect(closeCandidates([], 1000)).toEqual([])
  })

  it('returns nothing when every reply before the newest sits under half a threshold', () => {
    // Running totals: 100, 200, 300, 400, 500.
    const series = [opening(100), u(1, 100), r(1, 100), u(2, 100), r(2, 100)]
    expect(closeCandidates(series, 1000)).toEqual([])
  })

  // A zero-token reply at a total of 0 would sit inside a zero threshold's window.
  it.each([0, -1000, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns nothing for a threshold of %s',
    (threshold) => {
      expect(closeCandidates([r(1, 0), u(2, 0), r(2, 0)], threshold)).toEqual([])
    },
  )

  it("keeps the series' own fields on each candidate", () => {
    // Running totals: 100, 600, 1100.
    const series = [
      { id: 'o1', kind: 'opening' as const, position: 1, tokens: 100 },
      { id: 'r1', kind: 'ai_reply' as const, position: 3, tokens: 500 },
      { id: 'r2', kind: 'ai_reply' as const, position: 5, tokens: 500 },
    ]
    expect(closeCandidates(series, 1000)).toEqual([
      { id: 'r1', kind: 'ai_reply', position: 3, tokens: 500, tokensThrough: 600 },
    ])
  })

  // Swapped so the rule, not the kind, decides: u1 qualifies only through it, and u2 is the newest.
  it('asks canEndChapter, the one copy of the rule (C10)', async () => {
    const actual = await vi.importActual<{ canEndChapter: typeof canEndChapter }>(
      './can-end-chapter',
    )
    vi.mocked(canEndChapter).mockImplementation((entry) => entry.kind === 'user_action')
    try {
      // Running totals: 100, 500, 600, 1100.
      const series = [opening(100), u(1, 400), r(1, 100), u(2, 500)]
      expect(ids(closeCandidates(series, 1000))).toEqual(['u1'])
    } finally {
      vi.mocked(canEndChapter).mockImplementation(actual.canEndChapter)
    }
  })
})

// The window's bounds are the integer totals a candidate can hold: the filter is inclusive.
describe('closeCandidateWindow', () => {
  it('is half a threshold to one and a half for an even threshold', () => {
    expect(closeCandidateWindow(1000)).toEqual({ from: 500, to: 1500 })
  })

  it('rounds the low bound up and the high bound down for an odd threshold', () => {
    expect(closeCandidateWindow(1001)).toEqual({ from: 501, to: 1501 })
    expect(closeCandidateWindow(4003)).toEqual({ from: 2002, to: 6004 })
  })
})

describe('closeCandidates at an odd threshold', () => {
  it('keeps the same rows the window names: totals 501 through 1501', () => {
    // Running totals: 300, 500, 501, 1501, 1502, 1503.
    const series = [opening(300), r(1, 200), r(2, 1), r(3, 1000), r(4, 1), r(5, 1)]
    expect(ids(closeCandidates(series, 1001))).toEqual(['r2', 'r3'])
  })
})
