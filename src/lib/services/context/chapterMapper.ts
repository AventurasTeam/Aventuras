/**
 * Chapter Mapper
 *
 * Pure transformation function that converts raw Chapter[] and TimelineFillResult
 * into typed ContextChapter[] and ContextTimelineFill[] arrays suitable for
 * Liquid template variables.
 *
 * This is the data layer bridge between the chapter/timeline pipeline and
 * the template context builder (ContextBuilder).
 */

import type { Chapter, TimeTracker } from '$lib/types'
import type { TimelineFillResult } from '$lib/services/ai/retrieval/TimelineFillService'
import type { ContextChapter, ContextTimelineFill } from './context-types'

/**
 * Format a TimeTracker into a human-readable string for the narrative prompt.
 * Always returns a value, defaulting to Year 1, Day 1, 0 hours 0 minutes if null.
 *
 * Moved from NarrativeService.ts — co-located with its primary consumer.
 */
export function formatStoryTime(time: TimeTracker | null | undefined): string {
  const t = time ?? { years: 0, days: 0, hours: 0, minutes: 0 }
  const year = t.years + 1
  const day = t.days + 1
  return `Year ${year}, Day ${day}, ${t.hours} hours ${t.minutes} minutes`
}

/**
 * All chapter arrays produced by mapChaptersToContext().
 * These map directly to the Liquid template variables injected by the context pipeline.
 */
export interface ChapterContextArrays {
  /** Chapter summaries ordered by chapter number */
  chapters: ContextChapter[]
  /** Timeline gap-fill Q&A results */
  timelineFill: ContextTimelineFill[]
}

/**
 * Map Chapter[] and optional TimelineFillResult into typed context arrays
 * suitable for Liquid template injection.
 *
 * - chapters[]: each Chapter mapped to ContextChapter with pre-formatted time strings
 * - timelineFill[]: each TimelineQueryResult mapped to ContextTimelineFill
 *
 * Raw arrays (characters[], locations[]) are passed through unchanged so
 * templates can apply their own formatting (join, conditionals, etc.).
 *
 * @param chapters - Raw Chapter[] from the world state
 * @param timelineFillResult - Optional timeline gap-fill result from TimelineFillService
 * @returns ChapterContextArrays bag ready for template context injection
 */
export function mapChaptersToContext(
  chapters: Chapter[],
  timelineFillResult?: TimelineFillResult | null,
): ChapterContextArrays {
  const contextChapters: ContextChapter[] = chapters.map((c) => ({
    number: c.number,
    title: c.title ?? '',
    summary: c.summary,
    startTime: c.startTime ? formatStoryTime(c.startTime) : null,
    endTime: c.endTime ? formatStoryTime(c.endTime) : null,
    characters: c.characters ?? [],
    locations: c.locations ?? [],
    emotionalTone: c.emotionalTone ?? '',
  }))

  const contextTimelineFill: ContextTimelineFill[] = (timelineFillResult?.responses ?? []).map(
    (r) => ({
      query: r.query,
      answer: r.answer,
      chapterNumbers: r.chapterNumbers,
    }),
  )

  return { chapters: contextChapters, timelineFill: contextTimelineFill }
}
