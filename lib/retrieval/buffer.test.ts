import { describe, expect, it } from 'vitest'

import { composePromptBuffer } from './buffer'

type E = { id: string; position: number; kind: string; chapterId: string | null; content: string }

const entry = (n: number, chapterId: string | null = null, kind = 'ai_reply'): E => ({
  id: `e${n}`,
  position: n,
  kind,
  chapterId,
  content: `entry ${n}`,
})

const range = (from: number, to: number, chapterId: string | null = null): E[] =>
  Array.from({ length: to - from + 1 }, (_, i) => entry(from + i, chapterId))

const ids = (entries: readonly E[]): string[] => entries.map((e) => e.id)

// The window is a contiguous tail of the branch — a skipped entry leaves a hole
// at the seam between the closed and open portions, which neither portion alone
// reveals. Indexed from the front because slice(-0) returns the whole branch.
const expectBranchTail = (out: readonly E[], all: readonly E[]): void => {
  const ordered = all.filter((e) => e.kind !== 'system').sort((a, b) => a.position - b.position)
  expect(ids(out)).toEqual(ids(ordered.slice(ordered.length - out.length)))
}

// 8 closed-chapter entries then 2 open ones.
const mixed = [...range(1, 8, 'ch_1'), ...range(9, 10)]

describe('composePromptBuffer — partial mode', () => {
  const settings = { fullChapterInBuffer: false, partialChapterBuffer: 10, protectedBuffer: 10 }

  it('takes the last partialChapterBuffer entries when the open region is long enough', () => {
    const all = range(1, 50)
    const out = composePromptBuffer(all, settings)
    expect(out).toHaveLength(10)
    expect(out.at(0)?.id).toBe('e41')
    expect(out.at(-1)?.id).toBe('e50')
    expectBranchTail(out, all)
  })

  it('spills into the previous chapter to satisfy protectedBuffer', () => {
    // cadence.md example: partial, chapter has 2 entries -> 2 current + 8 previous.
    const out = composePromptBuffer(mixed, settings)
    expect(out).toHaveLength(10)
    expect(out.at(0)?.id).toBe('e1')
    expect(out.at(-1)?.id).toBe('e10')
    expectBranchTail(out, mixed)
  })

  it('does not spill once the open region reaches protectedBuffer', () => {
    const all = [...range(1, 5, 'ch_1'), ...range(6, 15)]
    const out = composePromptBuffer(all, settings)
    expect(out).toHaveLength(10)
    expect(out.every((e) => e.chapterId === null)).toBe(true)
    expectBranchTail(out, all)
  })

  it('spills across more than one closed chapter when the previous one is too short', () => {
    const all = [...range(1, 6, 'ch_1'), ...range(7, 10, 'ch_2'), ...range(11, 12)]
    const out = composePromptBuffer(all, settings)
    expect(ids(out)).toEqual(['e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12'])
    expect(new Set(out.map((e) => e.chapterId))).toEqual(new Set(['ch_1', 'ch_2', null]))
    expectBranchTail(out, all)
  })

  it('stops short of protectedBuffer when the branch has too few entries', () => {
    const all = [...range(1, 2, 'ch_1'), entry(3)]
    const out = composePromptBuffer(all, settings)
    expect(ids(out)).toEqual(['e1', 'e2', 'e3'])
    expectBranchTail(out, all)
  })

  it('fills from the closed tail when the open region is empty', () => {
    const all = range(1, 20, 'ch_1')
    const out = composePromptBuffer(all, settings)
    expect(out).toHaveLength(10)
    expect(out.at(0)?.id).toBe('e11')
    expect(out.at(-1)?.id).toBe('e20')
    expectBranchTail(out, all)
  })
})

describe('composePromptBuffer — full mode', () => {
  const settings = { fullChapterInBuffer: true, partialChapterBuffer: 10, protectedBuffer: 10 }

  it('takes the entire open region, ignoring partialChapterBuffer', () => {
    const all = range(1, 50)
    const out = composePromptBuffer(all, settings)
    expect(out).toHaveLength(50)
    expectBranchTail(out, all)
  })

  it('still spills to satisfy protectedBuffer on a short open region', () => {
    const out = composePromptBuffer(mixed, settings)
    expect(out).toHaveLength(10)
    expect(out.at(0)?.id).toBe('e1')
    expectBranchTail(out, mixed)
  })

  it('never spills once the open region exceeds protectedBuffer', () => {
    const all = [...range(1, 20, 'ch_1'), ...range(21, 32)]
    const out = composePromptBuffer(all, settings)
    expect(out).toHaveLength(12)
    expect(out.every((e) => e.chapterId === null)).toBe(true)
    expectBranchTail(out, all)
  })
})

// cadence.md gates spillover on the open region holding fewer entries than
// protectedBuffer, and fixes the total at max(partialChapterBuffer,
// protectedBuffer) above that — so the larger knob sizes the open-region window
// and closed prose only ever backfills what the open region cannot supply.
describe('composePromptBuffer — partialChapterBuffer against protectedBuffer', () => {
  const all = [...range(1, 20, 'ch_1'), ...range(21, 32)]

  it('widens the window to protectedBuffer when partial < protected', () => {
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 5,
      protectedBuffer: 10,
    })
    expect(ids(out)).toEqual(ids(range(23, 32)))
    expect(out.every((e) => e.chapterId === null)).toBe(true)
    expectBranchTail(out, all)
  })

  it('keeps the partialChapterBuffer window when partial > protected', () => {
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 8,
      protectedBuffer: 5,
    })
    expect(ids(out)).toEqual(ids(range(25, 32)))
    expectBranchTail(out, all)
  })

  it('takes that one window when partial === protected', () => {
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 6,
      protectedBuffer: 6,
    })
    expect(ids(out)).toEqual(ids(range(27, 32)))
    expectBranchTail(out, all)
  })

  it('still spills when partial < protected and the open region is exhausted', () => {
    const short = [...range(1, 20, 'ch_1'), ...range(21, 23)]
    const out = composePromptBuffer(short, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 5,
      protectedBuffer: 10,
    })
    expect(ids(out)).toEqual(ids(range(14, 23)))
    expectBranchTail(out, short)
  })
})

describe('composePromptBuffer — exclusions', () => {
  it('drops system entries from both the window and the count', () => {
    const all = [entry(1), entry(2, null, 'system'), entry(3)]
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 10,
      protectedBuffer: 0,
    })
    expect(ids(out)).toEqual(['e1', 'e3'])
    expectBranchTail(out, all)
  })

  it('excludes system entries from the spillover too', () => {
    const all = [...range(1, 8, 'ch_1'), entry(9, 'ch_1', 'system'), entry(10)]
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 10,
      protectedBuffer: 5,
    })
    expect(ids(out)).toEqual(['e5', 'e6', 'e7', 'e8', 'e10'])
    expectBranchTail(out, all)
  })

  it('returns ascending-by-position output regardless of input order', () => {
    const all = [entry(3), entry(1), entry(2)]
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: true,
      partialChapterBuffer: 10,
      protectedBuffer: 0,
    })
    expect(out.map((e) => e.position)).toEqual([1, 2, 3])
    expectBranchTail(out, all)
  })

  it('does not mutate the caller’s array', () => {
    const input = [entry(3), entry(1), entry(2)]
    composePromptBuffer(input, {
      fullChapterInBuffer: true,
      partialChapterBuffer: 10,
      protectedBuffer: 0,
    })
    expect(ids(input)).toEqual(['e3', 'e1', 'e2'])
  })

  it('returns an empty window for an empty branch', () => {
    const out = composePromptBuffer([], {
      fullChapterInBuffer: false,
      partialChapterBuffer: 10,
      protectedBuffer: 10,
    })
    expect(out).toEqual([])
    expectBranchTail(out, [])
  })
})

// storySettingsSchema puts no .min() or .int() on either count, so the finite
// cases below validate today; NaN and undefined are the same hardening
// lib/prompts/filters.ts → recent already pins.
describe('composePromptBuffer — unvalidated settings', () => {
  it.each([0, -5, Number.NaN, undefined])(
    'floors partialChapterBuffer at 1 for %s so it cannot send the whole open region',
    (partialChapterBuffer) => {
      const all = range(1, 3)
      const out = composePromptBuffer(all, {
        fullChapterInBuffer: false,
        partialChapterBuffer: partialChapterBuffer as number,
        protectedBuffer: 0,
      })
      expect(ids(out)).toEqual(['e3'])
      expectBranchTail(out, all)
    },
  )

  it('truncates a fractional partialChapterBuffer', () => {
    const all = range(1, 5)
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 2.7,
      protectedBuffer: 0,
    })
    expect(ids(out)).toEqual(['e4', 'e5'])
    expectBranchTail(out, all)
  })

  it.each([0, -5, Number.NaN, undefined])(
    'treats protectedBuffer %s as no floor rather than spilling the whole history',
    (protectedBuffer) => {
      const out = composePromptBuffer(mixed, {
        fullChapterInBuffer: false,
        partialChapterBuffer: 10,
        protectedBuffer: protectedBuffer as number,
      })
      expect(ids(out)).toEqual(['e9', 'e10'])
      expectBranchTail(out, mixed)
    },
  )

  it('truncates a fractional protectedBuffer below 1 to no floor', () => {
    const all = range(1, 8, 'ch_1')
    const out = composePromptBuffer(all, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 10,
      protectedBuffer: 0.5,
    })
    expect(out).toEqual([])
    expectBranchTail(out, all)
  })

  it('truncates a fractional protectedBuffer above 1', () => {
    const out = composePromptBuffer(mixed, {
      fullChapterInBuffer: false,
      partialChapterBuffer: 1,
      protectedBuffer: 5.9,
    })
    expect(ids(out)).toEqual(['e6', 'e7', 'e8', 'e9', 'e10'])
    expectBranchTail(out, mixed)
  })
})
