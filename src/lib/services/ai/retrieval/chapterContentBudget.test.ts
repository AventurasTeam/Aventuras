import { describe, it, expect } from 'vitest'
import {
  buildChapterRead,
  type ChapterForRead,
} from '$lib/services/ai/retrieval/chapterContentBudget'

function chapter(number: number, entryTokens: number[]): ChapterForRead {
  return {
    number,
    header: `## Chapter ${number}`,
    entries: entryTokens.map((tokens, i) => ({ text: `C${number}E${i}`, tokens })),
  }
}

describe('buildChapterRead', () => {
  it('includes everything and adds no marker when it fits', () => {
    const result = buildChapterRead([chapter(1, [10, 10]), chapter(2, [10])], 1000)

    expect(result.content).not.toContain('TRUNCATED')
    expect(result.content).toContain('C1E0')
    expect(result.content).toContain('C2E0')
    expect(result.omittedChapters).toEqual([])
    expect(result.partialChapters).toEqual([])
  })

  it('stops at the budget, cutting entries in order', () => {
    const result = buildChapterRead([chapter(1, [10, 10, 10])], 25)

    expect(result.content).toContain('C1E0')
    expect(result.content).toContain('C1E1')
    expect(result.content).not.toContain('C1E2')
    expect(result.partialChapters).toEqual([1])
  })

  it('names the chapters that got no text at all', () => {
    const result = buildChapterRead([chapter(1, [30]), chapter(2, [30]), chapter(3, [30])], 30)

    expect(result.omittedChapters).toEqual([2, 3])
    expect(result.content).toContain('Chapters 2, 3 not included at all')
    expect(result.content).not.toContain('## Chapter 2')
  })

  it('reports a partial chapter and an omitted one together', () => {
    const result = buildChapterRead([chapter(1, [10, 10]), chapter(2, [10])], 15)

    expect(result.partialChapters).toEqual([1])
    expect(result.omittedChapters).toEqual([2])
    expect(result.content).toContain('Chapter 1 is incomplete')
    expect(result.content).toContain('Chapter 2 not included at all')
  })

  it('keeps the first entry even when it alone exceeds the budget', () => {
    const result = buildChapterRead([chapter(1, [500])], 10)

    expect(result.content).toContain('C1E0')
    expect(result.omittedChapters).toEqual([])
  })

  it('does not resume a later chapter after the budget ran out', () => {
    const result = buildChapterRead([chapter(1, [100]), chapter(2, [1])], 100)

    expect(result.omittedChapters).toEqual([2])
  })

  it('stops for good at the cut, rather than filling later chapters from the remainder', () => {
    // A token is left over after chapter 1 is cut, and chapters 2 and 3 open with entries
    // small enough to fit in it. Spending it would return three chapter openings and no
    // whole chapter, and would report two chapters as "incomplete" at once.
    const result = buildChapterRead(
      [chapter(1, [100, 50]), chapter(2, [1, 50]), chapter(3, [1])],
      102,
    )

    expect(result.partialChapters).toEqual([1])
    expect(result.omittedChapters).toEqual([2, 3])
    expect(result.content).toContain('C1E0')
    expect(result.content).not.toContain('C2E0')
    expect(result.content).not.toContain('C3E0')
  })

  it('never reports more than one partial chapter', () => {
    const result = buildChapterRead(
      [chapter(1, [10, 10]), chapter(2, [1, 10]), chapter(3, [1, 10])],
      13,
    )

    expect(result.partialChapters).toHaveLength(1)
    // The marker's wording assumes one; the stop rule is what makes that true.
    expect(result.content).toContain('Chapter 1 is incomplete')
  })

  it('an empty chapter does not end the read', () => {
    // No entries means nothing was cut -- the budget is untouched, so the chapters after it
    // must still be assembled.
    const result = buildChapterRead([chapter(1, []), chapter(2, [10])], 1000)

    expect(result.omittedChapters).toEqual([1])
    expect(result.content).toContain('C2E0')
  })

  it('skips a chapter with no entries', () => {
    const result = buildChapterRead([chapter(1, [10]), chapter(2, [])], 1000)

    expect(result.omittedChapters).toEqual([2])
  })

  it('handles an empty chapter list', () => {
    expect(buildChapterRead([], 100)).toEqual({
      content: '',
      omittedChapters: [],
      partialChapters: [],
    })
  })
})
