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

/**
 * Build the payload for the chapter that just triggered this run.
 *
 * Renders `entries` with the same `[ACTION]` / `[NARRATIVE]` shape `runLoreManagement` already
 * uses for `recentStory`, so the two look like one voice in the prompt.
 */
export function buildNewChapterPayload(chapter: Chapter, entries: StoryEntry[]): LoreNewChapter {
  const text = entries
    .filter((e) => e.type === 'narration' || e.type === 'user_action')
    .map((e) => `[${e.type === 'user_action' ? 'ACTION' : 'NARRATIVE'}] ${e.content}`)
    .join('\n\n')

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
