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
