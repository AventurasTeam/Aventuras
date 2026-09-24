/**
 * Formatting for the chapter that just triggered a lore management run.
 *
 * Plain `.ts` so the two rules below are covered by a unit test: `LoreManagementService.ts`
 * reaches `ContextBuilder` and the agent SDK and has no test today.
 */

import type { Chapter, StoryEntry } from '$lib/types'
import type { LoreManagementChapter } from './LoreManagementService'

/** The triggering chapter, formatted for the prompt but not yet rendered into it. */
export interface LoreNewChapter {
  number: number
  title: string | null
  characters: string[]
  locations: string[]
  text: string
}

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
 * Build the payload for the chapter that just triggered this run.
 *
 * Returns `null` when there is nothing to show — `entries` is empty (which
 * `story.getChapterEntries` returns when it cannot place the chapter's boundary ids) or holds
 * only blank or non-prose entries. `loreChapterContext` keeps the chapter's summary then.
 */
export function buildNewChapterPayload(
  chapter: Chapter,
  entries: StoryEntry[],
): LoreNewChapter | null {
  const text = renderLoreProse(entries)

  if (!text) return null

  return {
    number: chapter.number,
    title: chapter.title,
    characters: chapter.characters,
    locations: chapter.locations,
    text,
  }
}

/**
 * Render the triggering chapter's prompt block.
 *
 * Facets are guarded with `?.length`, matching `NarrativeService.ts` — chapters are
 * persisted JSON, and one written before a field existed arrives without it.
 */
export function formatNewChapterSection(payload: LoreNewChapter): string {
  const heading = `# Chapter ${payload.number}${payload.title ? `: ${payload.title}` : ''} — just written, in full`

  const metadata: string[] = []
  if (payload.characters?.length) metadata.push(`Characters: ${payload.characters.join(', ')}`)
  if (payload.locations?.length) metadata.push(`Locations: ${payload.locations.join(', ')}`)
  const metaLine = metadata.length ? `*${metadata.join(' | ')}*\n` : ''

  return `${heading}\n${metaLine}\n${payload.text}\n`
}

/**
 * Project chapters to `{number, title, summary}`, dropping the one that triggered this run.
 *
 * Pure, so the rule this whole change turns on — chapter N in full *and* absent from the
 * summaries — is covered by a test rather than only by the manual pass.
 */
export function chapterSummariesExcluding(
  chapters: Chapter[],
  excludeId?: string,
): LoreManagementChapter[] {
  return chapters
    .filter((c) => c.id !== excludeId)
    .map((c) => ({ number: c.number, title: c.title, summary: c.summary }))
}

/**
 * The chapter list and triggering-chapter payload the agent is shown.
 *
 * The summary is dropped only when a payload replaces it, so a chapter is never shown twice
 * and never missing.
 */
export function loreChapterContext(
  chapters: Chapter[],
  newChapter: { chapter: Chapter; entries: StoryEntry[] } | undefined,
  sendFullText: boolean,
): { chapters: LoreManagementChapter[]; newChapter: LoreNewChapter | null } {
  const payload =
    sendFullText && newChapter
      ? buildNewChapterPayload(newChapter.chapter, newChapter.entries)
      : null
  return {
    chapters: chapterSummariesExcluding(chapters, payload ? newChapter?.chapter.id : undefined),
    newChapter: payload,
  }
}
