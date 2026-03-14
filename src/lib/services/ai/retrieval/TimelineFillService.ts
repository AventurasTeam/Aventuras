/**
 * Timeline Fill Service
 *
 * Answers questions about story timeline and fills in gaps using chapter summaries.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 */

import type { Chapter, StoryEntry } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { generatePlainText } from '../sdk/generate'
import { timelineQueriesResultSchema, type TimelineQuery } from '../sdk/schemas/timeline'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'
import { mapChaptersToContext } from '$lib/services/context/chapterMapper'
import type { ContextAnswerChapter } from '$lib/services/context/context-types'

const log = createLogger('TimelineFill')

// Type definitions
export interface TimelineAnswer {
  answer: string
  relevantChapters: string[]
  confidence: number
}

export interface TimelineFillSettings {
  enabled: boolean
  mode: 'static' | 'agentic'
  maxQueries: number
}

export function getDefaultTimelineFillSettings(): TimelineFillSettings {
  return {
    enabled: true,
    mode: 'static',
    maxQueries: 5,
  }
}

export interface ResolvedTimelineQuery {
  query: string
  resolved: boolean
}

export interface TimelineQueryResult {
  query: string
  answer: string
  chapterNumbers: number[]
}

export interface TimelineChapterInfo {
  number: number
  title: string | null
  summary: string
}

export interface TimelineFillResult {
  queries: TimelineQuery[]
  responses: TimelineQueryResult[]
  reasoning?: string
}

/**
 * Service that answers timeline questions using chapter summaries.
 */
export class TimelineFillService extends BaseAIService {
  private maxQueries: number

  constructor(serviceId: string, maxQueries: number = 5) {
    super(serviceId)
    this.maxQueries = maxQueries
  }

  /**
   * Generate queries to fill gaps in timeline knowledge.
   */
  async generateQueries(
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
  ): Promise<TimelineQuery[]> {
    log('generateQueries called', {
      visibleEntriesCount: visibleEntries.length,
      chaptersCount: chapters.length,
    })

    if (chapters.length === 0) {
      log('No chapters available, skipping query generation')
      return []
    }

    const storyEntries = mapStoryEntriesToContext(visibleEntries, { stripPicTags: false })
    const { chapters: contextChapters } = mapChaptersToContext(chapters)

    const ctx = new ContextBuilder()
    ctx.add({ storyEntries, chapters: contextChapters })
    const { system, user: prompt } = await ctx.render('timeline-fill')

    try {
      const result = await this.generate(
        timelineQueriesResultSchema,
        system,
        prompt,
        'timeline-fill',
      )

      log('Generated queries:', result.queries.length)
      return result.queries.slice(0, this.maxQueries)
    } catch (error) {
      log('Query generation failed:', error)
      return []
    }
  }

  /**
   * Answer a question about the story timeline.
   * @param getChapterEntries Optional callback to fetch full chapter entries for richer context
   */
  async answerQuestion(
    query: string,
    chapters: Chapter[],
    chapterNumbers?: number[],
    getChapterEntries?: (chapter: Chapter) => StoryEntry[],
  ): Promise<TimelineAnswer> {
    log('answerQuestion called', {
      query,
      chaptersCount: chapters.length,
      targetChapters: chapterNumbers,
      hasEntriesCallback: !!getChapterEntries,
    })

    // Filter to specific chapters if provided
    const targetChapters =
      chapterNumbers && chapterNumbers.length > 0
        ? chapters.filter((c) => chapterNumbers.includes(c.number))
        : chapters

    if (targetChapters.length === 0) {
      return {
        answer: 'No relevant chapters found.',
        relevantChapters: [],
        confidence: 0,
      }
    }

    const answerChapters: ContextAnswerChapter[] = targetChapters.map((c) => {
      const chapter: ContextAnswerChapter = {
        number: c.number,
        title: c.title ?? '',
        summary: c.summary,
      }
      if (getChapterEntries) {
        const entries = getChapterEntries(c)
        if (entries.length > 0) {
          chapter.entries = mapStoryEntriesToContext(entries, { stripPicTags: false })
        }
      }
      return chapter
    })

    const ctx = new ContextBuilder()
    ctx.add({ answerChapters, query })
    const { system, user: prompt } = await ctx.render('timeline-fill-answer')

    try {
      const answer = await generatePlainText(
        {
          presetId: this.presetId,
          system,
          prompt,
        },
        'timeline-fill-answer',
      )

      return {
        answer: answer.trim(),
        relevantChapters: targetChapters.map((c) => `Chapter ${c.number}`),
        confidence: 0.8,
      }
    } catch (error) {
      log('Answer generation failed:', error)
      return {
        answer: 'Unable to answer the question.',
        relevantChapters: [],
        confidence: 0,
      }
    }
  }

  /**
   * Run the full timeline fill process.
   * @param getChapterEntries Optional callback to fetch full chapter entries for richer context
   */
  async runTimelineFill(
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
    getChapterEntries?: (chapter: Chapter) => StoryEntry[],
  ): Promise<TimelineFillResult> {
    log('runTimelineFill called', {
      visibleEntriesCount: visibleEntries.length,
      chaptersCount: chapters.length,
      hasEntriesCallback: !!getChapterEntries,
    })

    if (chapters.length === 0) {
      return { queries: [], responses: [] }
    }

    // Step 1: Generate queries
    const queries = await this.generateQueries(visibleEntries, chapters)

    if (queries.length === 0) {
      return { queries: [], responses: [] }
    }

    // Step 2: Answer each query in parallel
    const responses = await Promise.all(
      queries.map(async (q) => {
        // Determine which chapters to query
        let chapterNumbers: number[] = []
        if (q.chapters && q.chapters.length > 0) {
          chapterNumbers = q.chapters
        } else if (q.startChapter !== undefined && q.endChapter !== undefined) {
          for (let i = q.startChapter; i <= q.endChapter; i++) {
            chapterNumbers.push(i)
          }
        }

        const answer = await this.answerQuestion(
          q.query,
          chapters,
          chapterNumbers,
          getChapterEntries,
        )

        return {
          query: q.query,
          answer: answer.answer,
          chapterNumbers,
        }
      }),
    )

    log('Timeline fill complete', {
      queriesGenerated: queries.length,
      responsesGenerated: responses.length,
    })

    return { queries, responses }
  }
}
