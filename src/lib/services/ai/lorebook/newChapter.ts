import type { Chapter, LoreNewChapterInput, StoryEntry } from '$lib/types'
import type { LoreManagementChapter } from './LoreManagementService'
import { MIN_RECENT_ENTRIES_FOR_LORE, splitRecentTail } from '../retrieval/recentTail'

/** Narration and player actions with something in them: the only entries the agent is shown. */
function isLoreProse(e: StoryEntry): boolean {
  return (e.type === 'narration' || e.type === 'user_action') && e.content.trim().length > 0
}

/** `[ACTION]` / `[NARRATIVE]` lines, non-prose and blank entries dropped. */
export function renderLoreProse(entries: StoryEntry[]): string {
  return entries
    .filter(isLoreProse)
    .map((e) => `[${e.type === 'user_action' ? 'ACTION' : 'NARRATIVE'}] ${e.content}`)
    .join('\n\n')
}

/**
 * The prose lore management quotes from the unchaptered tail.
 *
 * With `afterChapter` the tail continues straight on from the chapter, oldest entries first:
 * `entryLimit` takes exactly that many, otherwise `maxChars` bounds them above the floor of
 * `MIN_RECENT_ENTRIES_FOR_LORE`. Without it, the newest entries within the same budget.
 * `continues` is set when a read from the chapter stops short of the present.
 */
export function loreRecentEntries(
  tail: StoryEntry[],
  maxChars: number,
  afterChapter?: { entryLimit?: number },
): { shown: StoryEntry[]; continues: boolean } {
  const prose = tail.filter(isLoreProse)
  if (!afterChapter) {
    return {
      shown: splitRecentTail(prose, maxChars, MIN_RECENT_ENTRIES_FOR_LORE).shown,
      continues: false,
    }
  }
  const { entryLimit } = afterChapter
  const shown =
    entryLimit !== undefined
      ? prose.slice(0, Math.max(0, entryLimit))
      : splitRecentTail([...prose].reverse(), maxChars, MIN_RECENT_ENTRIES_FOR_LORE).shown.reverse()
  return { shown, continues: shown.length < prose.length }
}

/**
 * The chapter summaries and the triggering chapter's full-text section.
 *
 * A summary is dropped only when the section replaces it, so no chapter is shown twice or
 * left out.
 */
export function loreChapterContext(
  chapters: Chapter[],
  newChapter: LoreNewChapterInput | undefined,
  sendFullText: boolean,
): { chapters: LoreManagementChapter[]; newChapterSection: string } {
  const text = sendFullText && newChapter ? renderLoreProse(newChapter.entries) : ''
  const shown = text ? newChapter?.chapter : undefined
  return {
    chapters: chapters
      .filter((c) => c.id !== shown?.id)
      .map((c) => ({ number: c.number, title: c.title, summary: c.summary })),
    newChapterSection: shown ? formatSection(shown, text) : '',
  }
}

// Facets are guarded: chapters are persisted JSON, and one older than a field arrives without it.
function formatSection(chapter: Chapter, text: string): string {
  const heading = `# Chapter ${chapter.number}${chapter.title ? `: ${chapter.title}` : ''} — just written, in full`

  const metadata: string[] = []
  if (chapter.characters?.length) metadata.push(`Characters: ${chapter.characters.join(', ')}`)
  if (chapter.locations?.length) metadata.push(`Locations: ${chapter.locations.join(', ')}`)
  const metaLine = metadata.length ? `*${metadata.join(' | ')}*\n` : ''

  return `${heading}\n${metaLine}\n${text}\n`
}
