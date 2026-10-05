import { describe, it, expect } from 'vitest'
import type { Chapter, StoryEntry } from '$lib/types'
import {
  buildChapterBanners,
  chapterBannerLabel,
  lastResolvedChapterEnd,
  TAIL_BANNER_TITLE,
} from './chapterBanners'

function entry(id: string, position: number): StoryEntry {
  return {
    id,
    storyId: 's1',
    type: 'narration',
    content: id,
    parentId: null,
    position,
    createdAt: position,
    metadata: null,
    branchId: null,
  }
}

function chapter(
  id: string,
  number: number,
  startEntryId: string,
  endEntryId: string,
  title: string | null = `Title ${number}`,
): Chapter {
  return {
    id,
    storyId: 's1',
    number,
    title,
    startEntryId,
    endEntryId,
    entryCount: 0,
    summary: `Summary ${number}`,
    startTime: null,
    endTime: null,
    keywords: [],
    characters: [],
    locations: [],
    plotThreads: [],
    emotionalTone: null,
    branchId: null,
    createdAt: 0,
  }
}

const entries = [entry('e0', 0), entry('e1', 1), entry('e2', 2), entry('e3', 3), entry('e4', 4)]

describe('buildChapterBanners', () => {
  it('returns nothing for a story without chapters', () => {
    expect(buildChapterBanners(entries, []).size).toBe(0)
  })

  it('places a banner before each chapter start and one before the tail', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c1', 1, 'e0', 'e1'),
      chapter('c2', 2, 'e2', 'e3'),
    ])

    expect([...banners.keys()]).toEqual(['e0', 'e2', 'e4'])
    const tail = banners.get('e4')!
    expect(tail).toMatchObject({
      isTail: true,
      number: 3,
      title: TAIL_BANNER_TITLE,
      summary: null,
    })
    expect(banners.get('e0')).toMatchObject({ number: 1, title: 'Title 1', summary: 'Summary 1' })
  })

  it('has no tail banner when the last chapter ends the story', () => {
    const banners = buildChapterBanners(entries, [chapter('c1', 1, 'e0', 'e4')])
    expect([...banners.keys()]).toEqual(['e0'])
  })

  it('links banners in order, tail last', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c1', 1, 'e0', 'e1'),
      chapter('c2', 2, 'e2', 'e3'),
    ])

    expect(banners.get('e0')).toMatchObject({ prev: null, next: { entryId: 'e2', number: 2 } })
    expect(banners.get('e2')).toMatchObject({
      prev: { entryId: 'e0', number: 1 },
      next: { entryId: 'e4', number: 3 },
    })
    expect(banners.get('e4')).toMatchObject({ prev: { entryId: 'e2', number: 2 }, next: null })
  })

  it('orders by position in the story, not by chapter number', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c2', 2, 'e0', 'e1'),
      chapter('c1', 1, 'e2', 'e3'),
    ])

    expect(banners.get('e0')).toMatchObject({ number: 2, next: { entryId: 'e2', number: 1 } })
  })

  it('skips a chapter whose start or end is not in the entries', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c1', 1, 'e0', 'e1'),
      chapter('c2', 2, 'missing', 'e3'),
      chapter('c3', 3, 'e2', 'missing'),
    ])

    // c2's end still counts toward where the tail begins, as in getUnchapterizedEntries.
    expect([...banners.keys()]).toEqual(['e0', 'e4'])
    expect(banners.get('e4')!.isTail).toBe(true)
  })

  it('does not let a chapter with an unresolved end collide with the tail', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c1', 1, 'e0', 'e1'),
      chapter('c2', 2, 'e2', 'gone'),
    ])

    expect(banners.get('e2')).toMatchObject({ isTail: true, number: 3 })
  })

  it('numbers the tail past an unresolved chapter with the highest number', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c1', 1, 'e0', 'e1'),
      chapter('c9', 9, 'gone', 'gone'),
    ])

    expect(banners.get('e2')).toMatchObject({ isTail: true, number: 10 })
  })

  it('gives two chapters that share a start entry to the first, linking past the other', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c1', 1, 'e0', 'e1'),
      chapter('c2', 2, 'e0', 'e3'),
    ])

    expect([...banners.keys()]).toEqual(['e0', 'e4'])
    expect(banners.get('e0')).toMatchObject({ number: 1, next: { entryId: 'e4', number: 3 } })
    expect(banners.get('e4')).toMatchObject({ prev: { entryId: 'e0', number: 1 } })
  })

  it('gives a chapter that starts on the tail entry the banner, not the tail', () => {
    const banners = buildChapterBanners(entries, [
      chapter('c1', 1, 'e0', 'e1'),
      chapter('c2', 2, 'e2', 'e1'),
    ])

    expect(banners.get('e2')).toMatchObject({ isTail: false, number: 2 })
  })

  it('has no tail when no chapter end resolves', () => {
    const banners = buildChapterBanners(entries, [chapter('c1', 1, 'gone', 'gone')])
    expect(banners.size).toBe(0)
  })
})

describe('chapterBannerLabel', () => {
  it('includes the title when there is one', () => {
    expect(chapterBannerLabel({ number: 3, title: 'The Heist' })).toBe('Chapter 3: The Heist')
  })

  it('falls back to the number alone', () => {
    expect(chapterBannerLabel({ number: 3, title: null })).toBe('Chapter 3')
  })
})

describe('lastResolvedChapterEnd', () => {
  const indexById = new Map(entries.map((e, i) => [e.id, i]))

  it('is -1 when no chapter end resolves', () => {
    expect(lastResolvedChapterEnd(indexById, [chapter('c1', 1, 'gone', 'gone')])).toBe(-1)
    expect(lastResolvedChapterEnd(indexById, [])).toBe(-1)
  })

  it('is the highest resolved end, whatever the chapter order', () => {
    expect(
      lastResolvedChapterEnd(indexById, [
        chapter('c2', 2, 'e2', 'e3'),
        chapter('c9', 9, 'e0', 'gone'),
        chapter('c1', 1, 'e0', 'e1'),
      ]),
    ).toBe(3)
  })
})
