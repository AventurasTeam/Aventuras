import type { Chapter, StoryEntry } from '$lib/types'

export const TAIL_BANNER_TITLE = 'The Story Continues'

export interface ChapterBannerLink {
  /** The entry the banner sits before. */
  entryId: string
  number: number
}

export interface ChapterBanner {
  key: string
  chapterId: string | null
  number: number
  title: string | null
  summary: string | null
  isTail: boolean
  /** The entry this banner sits before. */
  startEntryId: string
  prev: ChapterBannerLink | null
  next: ChapterBannerLink | null
}

/**
 * Index of the last entry any chapter ends on, or -1 when no chapter end is in `indexById`.
 * The tail starts after it.
 */
export function lastResolvedChapterEnd(
  indexById: Map<string, number>,
  chapters: Chapter[],
): number {
  let lastEnd = -1
  for (const chapter of chapters) {
    const end = indexById.get(chapter.endEntryId)
    if (end !== undefined && end > lastEnd) lastEnd = end
  }
  return lastEnd
}

/**
 * Where chapter banners go, keyed by the entry each sits before, in story order rather than by
 * `number`. See docs/architecture/overview.md.
 */
export function buildChapterBanners(
  entries: StoryEntry[],
  chapters: Chapter[],
): Map<string, ChapterBanner> {
  const banners = new Map<string, ChapterBanner>()
  if (chapters.length === 0 || entries.length === 0) return banners

  const indexById = new Map(entries.map((entry, index) => [entry.id, index]))

  const placed: { index: number; banner: ChapterBanner }[] = []
  let maxNumber = 0

  for (const chapter of chapters) {
    maxNumber = Math.max(maxNumber, chapter.number)

    const start = indexById.get(chapter.startEntryId)
    const end = indexById.get(chapter.endEntryId)
    if (start === undefined || end === undefined) continue

    placed.push({
      index: start,
      banner: {
        key: `chapter:${chapter.id}`,
        chapterId: chapter.id,
        number: chapter.number,
        title: chapter.title,
        summary: chapter.summary,
        isTail: false,
        startEntryId: chapter.startEntryId,
        prev: null,
        next: null,
      },
    })
  }

  // No end resolved: calling the whole story a "tail" would be wrong, so there is none.
  const lastEnd = lastResolvedChapterEnd(indexById, chapters)
  const tailIndex = lastEnd + 1
  if (lastEnd !== -1 && tailIndex < entries.length) {
    const tailStart = entries[tailIndex]
    placed.push({
      index: tailIndex,
      banner: {
        key: 'tail',
        chapterId: null,
        number: maxNumber + 1,
        title: TAIL_BANNER_TITLE,
        summary: null,
        isTail: true,
        startEntryId: tailStart.id,
        prev: null,
        next: null,
      },
    })
  }

  placed.sort((a, b) => a.index - b.index)

  const seen = new Set<string>()
  const ordered = placed.filter(({ banner }) => {
    if (seen.has(banner.startEntryId)) return false
    seen.add(banner.startEntryId)
    return true
  })

  ordered.forEach(({ banner }, i) => {
    const before = ordered[i - 1]?.banner
    const after = ordered[i + 1]?.banner
    banner.prev = before ? { entryId: before.startEntryId, number: before.number } : null
    banner.next = after ? { entryId: after.startEntryId, number: after.number } : null
    banners.set(banner.startEntryId, banner)
  })

  return banners
}

/** `Chapter 3: The Heist`, or `Chapter 3` when the chapter has no title. */
export function chapterBannerLabel(banner: Pick<ChapterBanner, 'number' | 'title'>): string {
  return banner.title ? `Chapter ${banner.number}: ${banner.title}` : `Chapter ${banner.number}`
}
