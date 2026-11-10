import { describe, expect, it } from 'vitest'

import { cutChapterParts, partTokenLimit, UNKNOWN_WINDOW_PART_TOKENS } from './cut-parts'

// A reply unless a test says otherwise: a reply is a unit of its own.
const entry = (id: string, tokens: number, kind = 'ai_reply') => ({ id, kind, tokens })
const turn = (id: string, tokens: number) => entry(id, tokens, 'user_action')

describe('partTokenLimit', () => {
  it('is half a known window, floored', () => {
    expect(partTokenLimit(65_536)).toBe(32_768)
    expect(partTokenLimit(32_769)).toBe(16_384)
    expect(partTokenLimit(101)).toBe(50)
  })

  it('is 32,000 when the window is unknown', () => {
    expect(UNKNOWN_WINDOW_PART_TOKENS).toBe(32_000)
    expect(partTokenLimit(null)).toBe(32_000)
  })
})

describe('cutChapterParts', () => {
  it('keeps a chapter under the limit as one part, numbered 1', () => {
    expect(cutChapterParts([entry('a', 10), entry('b', 20), entry('c', 30)], 200)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'c', tokens: 60 },
    ])
  })

  // Limit 50: a and b make 45, and c would make 70.
  it('closes a part before an entry that would take it past the limit', () => {
    expect(
      cutChapterParts([entry('a', 25), entry('b', 20), entry('c', 25), entry('d', 25)], 100),
    ).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'b', tokens: 45 },
      { part: 2, startEntryId: 'c', endEntryId: 'd', tokens: 50 },
    ])
  })

  it('keeps an entry that exactly fills a part in it', () => {
    expect(cutChapterParts([entry('a', 30), entry('b', 20), entry('c', 1)], 100)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'b', tokens: 50 },
      { part: 2, startEntryId: 'c', endEntryId: 'c', tokens: 1 },
    ])
  })

  it('makes an entry over the limit a part alone, its neighbours in parts of their own', () => {
    expect(cutChapterParts([entry('a', 10), entry('b', 80), entry('c', 10)], 100)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'a', tokens: 10 },
      { part: 2, startEntryId: 'b', endEntryId: 'b', tokens: 80 },
      { part: 3, startEntryId: 'c', endEntryId: 'c', tokens: 10 },
    ])
  })

  // A 0-token row joins nothing an over-limit entry holds: the part is already past the limit.
  it('starts a part after an over-limit first entry, even for a row of 0 tokens', () => {
    expect(cutChapterParts([entry('a', 80), entry('b', 0), entry('c', 10)], 100)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'a', tokens: 80 },
      { part: 2, startEntryId: 'b', endEntryId: 'c', tokens: 10 },
    ])
  })

  // openRegionSeries reads a row stored with no count as 0 (C5).
  it('lets a row of 0 tokens join a full part', () => {
    expect(cutChapterParts([entry('a', 50), entry('b', 0), entry('c', 1)], 100)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'b', tokens: 50 },
      { part: 2, startEntryId: 'c', endEntryId: 'c', tokens: 1 },
    ])
  })

  it('cuts at 32,000 when the window is unknown', () => {
    expect(cutChapterParts([entry('a', 20_000), entry('b', 12_000)], null)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'b', tokens: 32_000 },
    ])
    expect(cutChapterParts([entry('a', 20_000), entry('b', 12_001)], null)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'a', tokens: 20_000 },
      { part: 2, startEntryId: 'b', endEntryId: 'b', tokens: 12_001 },
    ])
  })

  // Limit 50: a and b alone make 25 and c would make 55, which would end part 1 on turn b; as a
  // unit b and c make 35, so part 1 is a alone and b opens part 2.
  it("never ends a part on a player's turn: the turn moves to the part holding its reply", () => {
    expect(cutChapterParts([entry('a', 20), turn('b', 5), entry('c', 30)], 100)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'a', tokens: 20 },
      { part: 2, startEntryId: 'b', endEntryId: 'c', tokens: 35 },
    ])
  })

  // Limit 50: x is 40, and the run a, b with its reply c is 20 together.
  it("joins a run of player's turns to the reply after them", () => {
    expect(
      cutChapterParts([entry('x', 40), turn('a', 5), turn('b', 5), entry('c', 10)], 100),
    ).toEqual([
      { part: 1, startEntryId: 'x', endEntryId: 'x', tokens: 40 },
      { part: 2, startEntryId: 'a', endEntryId: 'c', tokens: 20 },
    ])
  })

  // Limit 50: the opening o is 10; a with its reply b joins it at 25; c with d would make 55.
  it("joins a player's turn and its reply to the open part, ending it on the reply", () => {
    expect(
      cutChapterParts(
        [entry('o', 10, 'opening'), turn('a', 5), entry('b', 10), turn('c', 5), entry('d', 25)],
        100,
      ),
    ).toEqual([
      { part: 1, startEntryId: 'o', endEntryId: 'b', tokens: 25 },
      { part: 2, startEntryId: 'c', endEntryId: 'd', tokens: 30 },
    ])
  })

  // Limit 50: the turn b with its reply c is 55, over the limit, so it is a part alone.
  it('makes a turn over the limit a part alone, though it passes the limit', () => {
    expect(
      cutChapterParts([entry('a', 10), turn('b', 10), entry('c', 45), entry('d', 5)], 100),
    ).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'a', tokens: 10 },
      { part: 2, startEntryId: 'b', endEntryId: 'c', tokens: 55 },
      { part: 3, startEntryId: 'd', endEntryId: 'd', tokens: 5 },
    ])
  })

  it("closes on a trailing player's turn with no entry after it", () => {
    expect(cutChapterParts([entry('a', 10), turn('b', 5)], 100)).toEqual([
      { part: 1, startEntryId: 'a', endEntryId: 'b', tokens: 15 },
    ])
  })

  it('returns no part for no entries', () => {
    expect(cutChapterParts([], 100)).toEqual([])
  })
})
