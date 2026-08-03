import { describe, it, expect } from 'vitest'
import type { TimelineQuery } from '../sdk/schemas/timeline'
import {
  resolveQueryChapterNumbers,
  chapterNumbersKey,
  groupByChapterCoverage,
} from './timelineFillGrouping'

function makeQuery(overrides: Partial<TimelineQuery> = {}): TimelineQuery {
  return { query: 'What happened?', ...overrides }
}

describe('resolveQueryChapterNumbers', () => {
  it('uses the explicit chapters list when present', () => {
    expect(resolveQueryChapterNumbers(makeQuery({ chapters: [5, 2] }))).toEqual([5, 2])
  })

  it('expands a startChapter/endChapter range inclusively', () => {
    expect(resolveQueryChapterNumbers(makeQuery({ startChapter: 3, endChapter: 5 }))).toEqual([
      3, 4, 5,
    ])
  })

  it('prefers the explicit chapters list over a range if both are present', () => {
    expect(
      resolveQueryChapterNumbers(makeQuery({ chapters: [7], startChapter: 1, endChapter: 3 })),
    ).toEqual([7])
  })

  it('returns an empty array when neither chapters nor a range is given', () => {
    expect(resolveQueryChapterNumbers(makeQuery())).toEqual([])
  })

  it('handles a single-chapter range (startChapter === endChapter)', () => {
    expect(resolveQueryChapterNumbers(makeQuery({ startChapter: 4, endChapter: 4 }))).toEqual([4])
  })
})

describe('chapterNumbersKey', () => {
  it('produces the same key regardless of input order', () => {
    expect(chapterNumbersKey([3, 1, 2])).toBe(chapterNumbersKey([1, 2, 3]))
  })

  it('produces different keys for different chapter sets', () => {
    expect(chapterNumbersKey([1, 2])).not.toBe(chapterNumbersKey([1, 2, 3]))
  })

  it('produces an empty string for an empty set', () => {
    expect(chapterNumbersKey([])).toBe('')
  })
})

describe('groupByChapterCoverage', () => {
  it('groups items sharing the exact same chapter set, order-independent', () => {
    const items = [
      { id: 'a', chapterNumbers: [1, 2] },
      { id: 'b', chapterNumbers: [2, 1] },
      { id: 'c', chapterNumbers: [3] },
    ]

    const groups = groupByChapterCoverage(items)

    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.chapterNumbers.join() === '1,2')?.items).toEqual([
      items[0],
      items[1],
    ])
    expect(groups.find((g) => g.chapterNumbers.join() === '3')?.items).toEqual([items[2]])
  })

  it('merges a subset chapter range into the superset group', () => {
    const items = [
      { id: 'wide', chapterNumbers: [1, 2, 3] },
      { id: 'narrow', chapterNumbers: [2] },
    ]

    const groups = groupByChapterCoverage(items)

    expect(groups).toHaveLength(1)
    expect(groups[0].chapterNumbers).toEqual([1, 2, 3])
    expect(groups[0].items.map((i) => i.id)).toEqual(['wide', 'narrow'])
  })

  it('merges regardless of the order the items arrive in', () => {
    const groups = groupByChapterCoverage([
      { id: 'narrow', chapterNumbers: [2] },
      { id: 'wide', chapterNumbers: [1, 2, 3] },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].chapterNumbers).toEqual([1, 2, 3])
  })

  it('does not merge sets that merely overlap', () => {
    const groups = groupByChapterCoverage([
      { id: 'a', chapterNumbers: [1, 2] },
      { id: 'b', chapterNumbers: [2, 3] },
    ])

    expect(groups).toHaveLength(2)
  })

  it('folds several narrow questions into one wide group', () => {
    const groups = groupByChapterCoverage([
      { id: 'a', chapterNumbers: [17] },
      { id: 'b', chapterNumbers: [17, 18, 19] },
      { id: 'c', chapterNumbers: [18, 19] },
      { id: 'd', chapterNumbers: [40] },
    ])

    expect(groups).toHaveLength(2)
    const wide = groups.find((g) => g.chapterNumbers.length === 3)
    expect(wide?.items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('preserves original relative order within a group', () => {
    const items = [
      { id: 'first', chapterNumbers: [5] },
      { id: 'second', chapterNumbers: [5] },
      { id: 'third', chapterNumbers: [5] },
    ]

    expect(groupByChapterCoverage(items)[0].items.map((i) => i.id)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('returns no groups for an empty input', () => {
    expect(groupByChapterCoverage([])).toEqual([])
  })

  it('treats a set with duplicates as the same set', () => {
    const groups = groupByChapterCoverage([
      { id: 'a', chapterNumbers: [1, 2] },
      { id: 'b', chapterNumbers: [2, 1, 1] },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].chapterNumbers).toEqual([1, 2])
  })
})

describe('groupByChapterCoverage — budget-aware hosting', () => {
  /** Hosts only sets of two chapters or fewer, standing in for a token budget. */
  const fitsTwo = (chapterNumbers: number[]) => chapterNumbers.length <= 2

  it('does not fold a narrow question into a host that will be truncated', () => {
    // The whole hazard: {17,18,19} is over budget and gets cut from chapter 19 down, so a
    // question about chapter 19 answered from it reads a text that stops before its own
    // chapter -- where alone it would have had the entire budget for it.
    const groups = groupByChapterCoverage(
      [
        { id: 'wide', chapterNumbers: [17, 18, 19] },
        { id: 'narrow', chapterNumbers: [19] },
      ],
      fitsTwo,
    )

    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.chapterNumbers.length === 1)?.items.map((i) => i.id)).toEqual([
      'narrow',
    ])
  })

  it('still folds into a host that fits', () => {
    const groups = groupByChapterCoverage(
      [
        { id: 'wide', chapterNumbers: [17, 18] },
        { id: 'narrow', chapterNumbers: [18] },
      ],
      fitsTwo,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.id)).toEqual(['wide', 'narrow'])
  })

  it('folds identical sets even when they are over budget', () => {
    // Two open-ended questions both resolve to every chapter. Splitting them would send the
    // same truncated text twice and buy nothing -- the truncation is identical either way.
    const groups = groupByChapterCoverage(
      [
        { id: 'a', chapterNumbers: [1, 2, 3] },
        { id: 'b', chapterNumbers: [1, 2, 3] },
      ],
      fitsTwo,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('hosts everything when no predicate is given', () => {
    const groups = groupByChapterCoverage([
      { id: 'wide', chapterNumbers: [17, 18, 19] },
      { id: 'narrow', chapterNumbers: [19] },
    ])

    expect(groups).toHaveLength(1)
  })
})
