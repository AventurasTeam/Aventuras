/**
 * Memory Service
 *
 * Handles chapter summarization and memory retrieval for long-form narratives.
 */

import type { Chapter, StoryEntry } from '$lib/types'
import { generateStructured } from '../sdk/generate'
import { ContextBuilder } from '$lib/services/context'
import {
  chapterAnalysisSchema,
  chapterSummaryResultSchema,
  retrievalDecisionSchema,
  type ChapterAnalysis,
  type ChapterSummaryResult,
  type RetrievalDecision,
} from '../sdk/schemas/memory'
import { createLogger } from '../core/config'

const log = createLogger('Memory')

export const DEFAULT_MEMORY_CONFIG = {
  tokenThreshold: 24000,
  chapterBuffer: 10,
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
  recentNarrative: string
  availableChapters: Chapter[]
}

export class MemoryService {
  private presetId: string

  constructor(presetId: string = 'memory') {
    this.presetId = presetId
  }

  /**
   * Generate chapter summary from entries.
   */
  async summarizeChapter(
    entries: StoryEntry[],
    previousChapters?: Chapter[],
    mode: string = 'adventure',
    pov: string = 'second',
    tense: string = 'present',
  ): Promise<ChapterSummaryResult> {
    log('summarizeChapter', {
      entryCount: entries.length,
      previousChaptersCount: previousChapters?.length ?? 0,
    })

    const entriesText = entries.map((e) => `[${e.type}]: ${e.content}`).join('\n\n')

    const previousChaptersContext =
      previousChapters && previousChapters.length > 0
        ? `Previous chapters:\n${previousChapters.map((c) => `Chapter ${c.number}: ${c.summary}`).join('\n\n')}`
        : ''

    const ctx = new ContextBuilder()
    ctx.add({
      mode,
      pov,
      tense,
      chapterContent: entriesText,
      previousContext: previousChaptersContext,
    })
    const { system, user: prompt } = await ctx.render('chapter-summarization')

    const result = await generateStructured(
      {
        presetId: this.presetId,
        schema: chapterSummaryResultSchema,
        system,
        prompt,
      },
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
  async analyzeForChapter(
    entries: StoryEntry[],
    lastChapterEndIndex: number,
    tokensOutsideBuffer: number,
    mode: string = 'adventure',
    pov: string = 'second',
    tense: string = 'present',
  ): Promise<ChapterAnalysis> {
    log('analyzeForChapter', { entryCount: entries.length, tokensOutsideBuffer })

    const firstValidMessageId = lastChapterEndIndex + 1
    const lastValidMessageId = firstValidMessageId + entries.length - 1
    const entriesText = entries
      .map((e, index) => `[Message ${firstValidMessageId + index}] [${e.type}]: ${e.content}`)
      .join('\n\n')

    const ctx = new ContextBuilder()
    ctx.add({
      mode,
      pov,
      tense,
      messagesInRange: entriesText,
      firstValidId: firstValidMessageId.toString(),
      lastValidId: lastValidMessageId.toString(),
    })
    const { system, user: prompt } = await ctx.render('chapter-analysis')

    const result = await generateStructured(
      {
        presetId: this.presetId,
        schema: chapterAnalysisSchema,
        system,
        prompt,
      },
      'chapter-analysis',
    )

    log('analyzeForChapter complete', {
      shouldCreateChapter: result.shouldCreateChapter,
      optimalEndIndex: result.optimalEndIndex,
      keywordCount: result.keywords.length,
    })

    return result
  }

  /**
   * Decide whether to retrieve past chapters for context.
   */
  async decideRetrieval(
    context: RetrievalContext,
    mode: string = 'adventure',
    pov: string = 'second',
    tense: string = 'present',
  ): Promise<RetrievalDecision> {
    log('decideRetrieval', { chaptersAvailable: context.availableChapters.length })

    if (context.availableChapters.length === 0) {
      return { shouldRetrieve: false, relevantChapterIds: [] }
    }

    const chapterSummaries = context.availableChapters
      .map((c) => `Chapter ${c.number}: ${c.summary}`)
      .join('\n\n')

    const ctx = new ContextBuilder()
    ctx.add({
      mode,
      pov,
      tense,
      userInput: context.userInput,
      recentContext: context.recentNarrative,
      chapterSummaries,
      maxChaptersPerRetrieval: DEFAULT_MEMORY_CONFIG.maxChaptersPerRetrieval.toString(),
    })
    const { system, user: prompt } = await ctx.render('retrieval-decision')

    const result = await generateStructured(
      {
        presetId: this.presetId,
        schema: retrievalDecisionSchema,
        system,
        prompt,
      },
      'retrieval-decision',
    )

    log('decideRetrieval complete', {
      shouldRetrieve: result.shouldRetrieve,
      relevantCount: result.relevantChapterIds.length,
    })

    return result
  }

  /**
   * Build context block from retrieved chapters.
   * @param getChapterEntries Optional callback to fetch full chapter entries for richer context
   */
  buildRetrievedContextBlock(
    chapters: Chapter[],
    decision: RetrievalDecision,
    getChapterEntries?: (chapter: Chapter) => StoryEntry[],
  ): string {
    if (!decision.shouldRetrieve || decision.relevantChapterIds.length === 0) {
      return ''
    }

    const relevantChapters = chapters.filter((c) => decision.relevantChapterIds.includes(c.id))
    if (relevantChapters.length === 0) {
      return ''
    }

    let block = '\n\n[RETRIEVED MEMORY]\n'
    block += 'The following is relevant context from earlier in the story:\n'

    for (const chapter of relevantChapters) {
      block += `\n--- Chapter ${chapter.number} ---\n`

      // Use full entries if callback provided, otherwise use summary
      if (getChapterEntries) {
        const entries = getChapterEntries(chapter)
        if (entries.length > 0) {
          block += entries
            .map((e) => `[${e.type === 'user_action' ? 'ACTION' : 'NARRATIVE'}]: ${e.content}`)
            .join('\n\n')
        } else {
          block += chapter.summary
        }
      } else {
        block += chapter.summary
      }

      if (chapter.keywords && chapter.keywords.length > 0) {
        block += `\n[Keywords: ${chapter.keywords.join(', ')}]`
      }
    }

    return block
  }
}
