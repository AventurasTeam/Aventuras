import { describe, it, expect, vi } from 'vitest'
import type { Chapter, MemoryConfig, StoryEntry } from '#lib/types/index.ts'
import {
  ChapterService,
  type ChapterCheckInput,
  type ChapterServiceDependencies,
} from './ChapterService'

const entries = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, metadata: {} }) as StoryEntry)

const input = (over: Partial<ChapterCheckInput> = {}): ChapterCheckInput => ({
  storyId: 'story',
  currentBranchId: 'branch-a',
  entries,
  lastChapterEndIndex: 0,
  tokensSinceLastChapter: 5000,
  tokensOutsideBuffer: 5000,
  messagesSinceLastChapter: 10,
  memoryConfig: { tokenThreshold: 4000, chapterBuffer: 2, summaryDetail: 'auto' } as MemoryConfig,
  currentBranchChapters: [{ number: 3 } as Chapter, { number: 1 } as Chapter],
  mode: 'adventure',
  pov: 'second',
  tense: 'present',
  ...over,
})

function deps(over: Partial<ChapterServiceDependencies> = {}): ChapterServiceDependencies {
  return {
    analyzeForChapter: vi.fn(async () => ({
      shouldCreateChapter: true,
      optimalEndIndex: 6,
      suggestedTitle: 'The Ferry',
      keywords: [],
    })) as any,
    summarizeChapter: vi.fn(async () => ({ summary: 'They crossed.', keywords: [] })) as any,
    addChapter: vi.fn(async () => {}),
    ...over,
  }
}

describe('isDue', () => {
  it('is not due below the threshold', () => {
    expect(new ChapterService(deps()).isDue(input({ tokensOutsideBuffer: 3999 }))).toBe(false)
  })

  it('is not due with nothing outside the buffer', () => {
    expect(new ChapterService(deps()).isDue(input({ tokensOutsideBuffer: 0 }))).toBe(false)
  })

  it('is not due when every entry after the last chapter is in the buffer', () => {
    expect(new ChapterService(deps()).isDue(input({ lastChapterEndIndex: 8 }))).toBe(false)
  })

  it('is due past the threshold with entries to cut', () => {
    expect(new ChapterService(deps()).isDue(input())).toBe(true)
  })
})

describe('check', () => {
  it('returns null when the analysis says not yet', async () => {
    const d = deps({
      analyzeForChapter: vi.fn(async () => ({ shouldCreateChapter: false })) as any,
    })
    expect(await new ChapterService(d).check(input(), 'check')).toBeNull()
  })

  it('passes its parent to the analysis and numbers from the chapters it was given', async () => {
    const d = deps()
    const cut = await new ChapterService(d).check(input(), 'check')

    expect(cut).toMatchObject({ number: 4, suggestedTitle: 'The Ferry' })
    expect(cut!.entries.map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
    expect((d.analyzeForChapter as any).mock.calls[0][8]).toBe('check')
  })

  it('keeps the end out of the buffer', async () => {
    const d = deps({
      analyzeForChapter: vi.fn(async () => ({
        shouldCreateChapter: true,
        optimalEndIndex: 10,
      })) as any,
    })
    const cut = await new ChapterService(d).check(input(), 'check')
    expect(cut!.entries).toHaveLength(8)
  })
})

describe('create', () => {
  it('adds the chapter to the turn’s story and branch, with the summary’s parent', async () => {
    const d = deps()
    const service = new ChapterService(d)
    const cut = (await service.check(input(), 'check'))!

    const chapter = await service.create(input(), cut, 'summary')

    expect(chapter).toMatchObject({
      number: 4,
      title: 'The Ferry',
      branchId: 'branch-a',
      startEntryId: 'e0',
      endEntryId: 'e5',
      summary: 'They crossed.',
    })
    expect(d.addChapter).toHaveBeenCalledWith(chapter, { storyId: 'story', branchId: 'branch-a' })
    expect((d.summarizeChapter as any).mock.calls[0][7]).toBe('summary')
  })
})
