/**
 * Memory Service
 *
 * Handles chapter summarization and memory retrieval for long-form narratives.
 */

import type { Chapter, StoryEntry } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import {
  chapterAnalysisSchema,
  chapterSummaryResultSchema,
  type ChapterSummaryResult,
} from '../sdk/schemas/memory'
import { AI_CONFIG } from '../core/config'
import { createLogger } from '$lib/log'
import { story } from '$lib/stores/story/index.svelte'

const log = createLogger('Memory')

export const DEFAULT_MEMORY_CONFIG = {
  tokenThreshold: AI_CONFIG.memory.defaultTokenThreshold,
  chapterBuffer: AI_CONFIG.memory.defaultChapterBuffer,
  autoSummarize: true,
  enableRetrieval: true,
  maxChaptersPerRetrieval: 3,
}

export interface RetrievedContext {
  chapters: Chapter[]
  contextBlock: string
}

export interface RetrievalContext {
  userInput: string
  recentEntries: StoryEntry[]
  availableChapters: Chapter[]
}

export class MemoryService extends BaseAIService {
  constructor(serviceId: string) {
    super(serviceId)
  }

  /**
   * Generate chapter summary from entries.
   */
  async summarizeChapter(): Promise<ChapterSummaryResult> {
    log('summarizeChapter', {
      entryCount: story.generationContext.chapterAnalysis.chapterEntries?.length,
    })
    const ctx = new ContextBuilder()
    ctx.add(story.generationContext.promptContext)
    const { system, user: prompt } = await ctx.render('chapter-summarization')

    const result = await this.generate(
      chapterSummaryResultSchema,
      system,
      prompt,
      'chapter-summarization',
    )

    log('summarizeChapter complete', {
      hasSummary: !!result.summary,
      hasTitle: !!result.title,
      keywordCount: result.keywords.length,
    })

    return result
  }

  /**
   * Analyze entries to determine if a chapter should be created.
   */
  async analyzeForChapter(): Promise<true> {
    log('analyzeForChapter')

    const ctx = new ContextBuilder()
    ctx.add(story.generationContext.promptContext)
    const { system, user: prompt } = await ctx.render('chapter-analysis')

    const result = await this.generate(chapterAnalysisSchema, system, prompt, 'chapter-analysis')

    log('analyzeForChapter complete', {
      shouldCreateChapter: result.shouldCreateChapter,
      optimalEndIndex: result.optimalEndIndex,
      keywordCount: result.keywords.length,
    })

    story.generationContext.chapterAnalysis.result = result
    return true
  }
}
