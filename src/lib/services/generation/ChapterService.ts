/**
 * ChapterService - Handles chapter creation logic extracted from ActionInput.svelte.
 * Coordinates AI analysis and chapter creation without triggering lore management directly.
 */

import type {
  Chapter,
  StoryEntry,
  MemoryConfig,
  TimeTracker,
  StoryMode,
  POV,
  Tense,
} from '$lib/types'
import type { ChapterAnalysis, ChapterSummaryResult } from '$lib/services/ai/sdk/schemas/memory'
import { aiService } from '../ai'
import { story } from '$lib/stores/story/index.svelte'

function log(...args: unknown[]) {
  console.log('[ChapterService]', ...args)
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChapterAnalysisResult extends ChapterAnalysis {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChapterSummaryData extends ChapterSummaryResult {}

export interface ChapterCheckInput {
  storyId: string
  currentBranchId: string | null
  entries: StoryEntry[]
  lastChapterEndIndex: number
  tokensSinceLastChapter: number
  tokensOutsideBuffer: number
  messagesSinceLastChapter: number
  memoryConfig: MemoryConfig
  currentBranchChapters: Chapter[]
  mode: StoryMode
  pov: POV
  tense: Tense
}

export interface ChapterCreationResult {
  created: boolean
  chapter?: Chapter
  loreManagementTriggered: boolean
}

export class ChapterService {
  async checkAndCreateChapter(): Promise<ChapterCreationResult> {
    const entries = story.entry.rawEntries
    const memoryConfig = story.settings.memoryConfig
    const tokensOutsideBuffer = story.generationContext.tokensOutsideBuffer
    const tokensSinceLastChapter = story.generationContext.tokensSinceLastChapter
    const messagesSinceLastChapter = story.chapter.messagesSinceLastChapter

    log('checkAndCreateChapter', {
      tokensSinceLastChapter: tokensSinceLastChapter,
      tokensOutsideBuffer,
      tokenThreshold: memoryConfig.tokenThreshold,
      messagesOutsideBuffer: messagesSinceLastChapter - memoryConfig.chapterBuffer,
    })

    if (tokensOutsideBuffer === 0) {
      log('No messages outside buffer, skipping')
      return { created: false, loreManagementTriggered: false }
    }

    if (tokensOutsideBuffer < memoryConfig.tokenThreshold) {
      log('Tokens outside buffer below threshold, skipping', {
        tokensOutsideBuffer,
        tokenThreshold: memoryConfig.tokenThreshold,
      })
      return { created: false, loreManagementTriggered: false }
    }

    // Chapter endpoints must stay outside the protected tail buffer.
    const protectedCount = Math.max(0, memoryConfig.chapterBuffer)
    const maxSelectableEndIndex = Math.max(0, entries.length - protectedCount)
    const startIndex = story.chapter.lastChapterEndIndex
    const analysisEntries = entries.slice(startIndex, maxSelectableEndIndex)
    story.generationContext.chapterAnalysis.analysisEntries = analysisEntries
    if (maxSelectableEndIndex <= startIndex) {
      log('No non-protected entries available for chapter end, skipping', {
        startIndex,
        maxSelectableEndIndex,
        protectedCount,
      })
      return { created: false, loreManagementTriggered: false }
    }

    await aiService.analyzeForChapter()
    const analysis = story.generationContext.chapterAnalysis
    if (!analysis.result) {
      throw new Error('Chapter analysis failed')
    }

    if (!analysis.result.shouldCreateChapter) {
      log('No chapter needed yet')
      return { created: false, loreManagementTriggered: false }
    }

    const clampedEndIndex = Math.min(
      Math.max(analysis.result.optimalEndIndex, startIndex + 1),
      maxSelectableEndIndex,
    )

    if (clampedEndIndex !== analysis.result.optimalEndIndex) {
      log('Adjusted chapter endpoint to non-protected range', {
        requestedEndIndex: analysis.result.optimalEndIndex,
        clampedEndIndex,
        startIndex,
        maxSelectableEndIndex,
      })
    }

    log('Creating new chapter', {
      optimalEndIndex: analysis.result.optimalEndIndex,
      finalEndIndex: clampedEndIndex,
      maxSelectableEndIndex,
    })

    const chapterEntries = entries.slice(startIndex, clampedEndIndex)
    story.generationContext.chapterAnalysis.chapterEntries = chapterEntries
    if (chapterEntries.length === 0) {
      log('No entries for chapter')
      return { created: false, loreManagementTriggered: false }
    }

    const summary = await aiService.summarizeChapter()
    const chapterNumber = await story.chapter.getNextChapterNumber()

    const firstEntry = chapterEntries[0]
    const lastEntry = chapterEntries[chapterEntries.length - 1]
    const startTime = (firstEntry.metadata?.timeStart as TimeTracker | undefined) ?? null
    const endTime = (lastEntry.metadata?.timeEnd as TimeTracker | undefined) ?? null

    const chapter: Chapter = {
      id: crypto.randomUUID(),
      storyId: story.id!,
      number: chapterNumber,
      title: analysis.result.suggestedTitle ?? summary.title ?? null,
      startEntryId: chapterEntries[0].id,
      endEntryId: chapterEntries[chapterEntries.length - 1].id,
      entryCount: chapterEntries.length,
      summary: summary.summary,
      startTime,
      endTime,
      keywords: summary.keywords,
      characters: summary.characters,
      locations: summary.locations,
      plotThreads: summary.plotThreads,
      emotionalTone: summary.emotionalTone ?? null,
      branchId: story.branch.currentBranchId,
      createdAt: Date.now(),
    }

    await story.chapter.addChapter(chapter)
    log('Chapter created', { number: chapterNumber, title: chapter.title })

    return { created: true, chapter, loreManagementTriggered: true }
  }
}
