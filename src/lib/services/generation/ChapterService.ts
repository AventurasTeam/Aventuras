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

export interface ChapterServiceDependencies {
  analyzeForChapter: (
    entries: StoryEntry[],
    lastChapterEndIndex: number,
    config: MemoryConfig,
    tokensOutsideBuffer: number,
    mode?: StoryMode,
    pov?: POV,
    tense?: Tense,
  ) => Promise<ChapterAnalysisResult>

  summarizeChapter: (
    entries: StoryEntry[],
    previousChapters?: Chapter[],
    mode?: StoryMode,
    pov?: POV,
    tense?: Tense,
  ) => Promise<ChapterSummaryData>

  getNextChapterNumber: () => Promise<number>
  addChapter: (chapter: Chapter) => Promise<void>
}

export interface ChapterCreationResult {
  created: boolean
  chapter?: Chapter
  loreManagementTriggered: boolean
}

export class ChapterService {
  private deps: ChapterServiceDependencies

  constructor(deps: ChapterServiceDependencies) {
    this.deps = deps
  }

  async checkAndCreateChapter(input: ChapterCheckInput): Promise<ChapterCreationResult> {
    const { entries, tokensOutsideBuffer, memoryConfig, currentBranchChapters, mode, pov, tense } =
      input

    log('checkAndCreateChapter', {
      tokensSinceLastChapter: input.tokensSinceLastChapter,
      tokensOutsideBuffer,
      tokenThreshold: memoryConfig.tokenThreshold,
      messagesOutsideBuffer: input.messagesSinceLastChapter - memoryConfig.chapterBuffer,
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
    const startIndex = input.lastChapterEndIndex
    const analysisEntries = entries.slice(startIndex, maxSelectableEndIndex)
    if (maxSelectableEndIndex <= startIndex) {
      log('No non-protected entries available for chapter end, skipping', {
        startIndex,
        maxSelectableEndIndex,
        protectedCount,
      })
      return { created: false, loreManagementTriggered: false }
    }

    const analysis = await this.deps.analyzeForChapter(
      analysisEntries,
      input.lastChapterEndIndex,
      memoryConfig,
      tokensOutsideBuffer,
      mode,
      pov,
      tense,
    )

    if (!analysis.shouldCreateChapter) {
      log('No chapter needed yet')
      return { created: false, loreManagementTriggered: false }
    }

    const clampedEndIndex = Math.min(
      Math.max(analysis.optimalEndIndex, startIndex + 1),
      maxSelectableEndIndex,
    )

    if (clampedEndIndex !== analysis.optimalEndIndex) {
      log('Adjusted chapter endpoint to non-protected range', {
        requestedEndIndex: analysis.optimalEndIndex,
        clampedEndIndex,
        startIndex,
        maxSelectableEndIndex,
      })
    }

    log('Creating new chapter', {
      optimalEndIndex: analysis.optimalEndIndex,
      finalEndIndex: clampedEndIndex,
      maxSelectableEndIndex,
    })

    const chapterEntries = entries.slice(startIndex, clampedEndIndex)

    if (chapterEntries.length === 0) {
      log('No entries for chapter')
      return { created: false, loreManagementTriggered: false }
    }

    const previousChapters = [...currentBranchChapters].sort((a, b) => a.number - b.number)
    const summary = await this.deps.summarizeChapter(
      chapterEntries,
      previousChapters,
      mode,
      pov,
      tense,
    )
    const chapterNumber = await this.deps.getNextChapterNumber()

    const firstEntry = chapterEntries[0]
    const lastEntry = chapterEntries[chapterEntries.length - 1]
    const startTime = (firstEntry.metadata?.timeStart as TimeTracker | undefined) ?? null
    const endTime = (lastEntry.metadata?.timeEnd as TimeTracker | undefined) ?? null

    const chapter: Chapter = {
      id: crypto.randomUUID(),
      storyId: input.storyId,
      number: chapterNumber,
      title: analysis.suggestedTitle ?? summary.title ?? null,
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
      branchId: input.currentBranchId,
      createdAt: Date.now(),
    }

    await this.deps.addChapter(chapter)
    log('Chapter created', { number: chapterNumber, title: chapter.title })

    return { created: true, chapter, loreManagementTriggered: true }
  }
}
