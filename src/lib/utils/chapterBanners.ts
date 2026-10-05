import type { Chapter, StoryEntry } from '$lib/types'

export const TAIL_BANNER_TITLE = 'The Story Continues'

export interface ChapterBannerLink {
  /** The entry the banner sits before. */
  entryId: string
  number: number
}

export interface ChapterBanner {
  number: number
  title: string | null
  summary: string | null
  isTail: boolean
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

  type Placed = { index: number; entryId: string; banner: Omit<ChapterBanner, 'prev' | 'next'> }
  const placed: Placed[] = []
  let maxNumber = 0

  for (const chapter of chapters) {
    maxNumber = Math.max(maxNumber, chapter.number)

    const start = indexById.get(chapter.startEntryId)
    const end = indexById.get(chapter.endEntryId)
    if (start === undefined || end === undefined) continue

    placed.push({
      index: start,
      entryId: chapter.startEntryId,
      banner: {
        number: chapter.number,
        title: chapter.title,
        summary: chapter.summary,
        isTail: false,
      },
    })
  }

  // No end resolved: calling the whole story a "tail" would be wrong, so there is none.
  const lastEnd = lastResolvedChapterEnd(indexById, chapters)
  const tailIndex = lastEnd + 1
  if (lastEnd !== -1 && tailIndex < entries.length) {
    placed.push({
      index: tailIndex,
      entryId: entries[tailIndex].id,
      banner: { number: maxNumber + 1, title: TAIL_BANNER_TITLE, summary: null, isTail: true },
    })
  }

  // Stable, so of two banners on one entry the earlier-placed one (a chapter over the tail,
  // the first of two chapters) keeps it.
  placed.sort((a, b) => a.index - b.index)
  const ordered: Placed[] = []
  for (const item of placed) {
    if (ordered[ordered.length - 1]?.entryId !== item.entryId) ordered.push(item)
  }

  ordered.forEach(({ entryId, banner }, i) => {
    const before = ordered[i - 1]
    const after = ordered[i + 1]
    banners.set(entryId, {
      ...banner,
      prev: before ? { entryId: before.entryId, number: before.banner.number } : null,
      next: after ? { entryId: after.entryId, number: after.banner.number } : null,
    })
  })

  return banners
}

/** `Chapter 3: The Heist`, or `Chapter 3` when the chapter has no title. */
export function chapterBannerLabel(banner: Pick<ChapterBanner, 'number' | 'title'>): string {
  return banner.title ? `Chapter ${banner.number}: ${banner.title}` : `Chapter ${banner.number}`
}
