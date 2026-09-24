import type { Chapter, LoreNewChapterInput, StoryEntry } from '$lib/types'
import type { LoreManagementChapter } from './LoreManagementService'

/** `[ACTION]` / `[NARRATIVE]` lines, non-prose and blank entries dropped. */
export function renderLoreProse(entries: StoryEntry[]): string {
  return entries
    .filter(
      (e) => (e.type === 'narration' || e.type === 'user_action') && e.content.trim().length > 0,
    )
    .map((e) => `[${e.type === 'user_action' ? 'ACTION' : 'NARRATIVE'}] ${e.content}`)
    .join('\n\n')
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
