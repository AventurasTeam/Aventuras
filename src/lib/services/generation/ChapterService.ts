/**
 * ChapterService - Handles chapter creation logic extracted from ActionInput.svelte.
 * Coordinates AI analysis and chapter creation without triggering lore management directly.
 *
 * Split in two: `check` is the turn's work and `create` the chapter creation card's, so the
 * caller can put the boundary between the two records between them.
 */

import type {
  Chapter,
  StoryEntry,
  MemoryConfig,
  TimeTracker,
  StoryMode,
  POV,
  Tense,
  SummaryDetail,
} from '#lib/types/index.ts'
import type { ChapterAnalysis, ChapterSummaryResult } from '#lib/services/ai/sdk/schemas/memory.ts'
import type { BranchScope } from '#lib/utils/branchScope.ts'
import { createLogger } from '#lib/log.ts'

const log = createLogger('ChapterService')

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChapterAnalysisResult extends ChapterAnalysis {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChapterSummaryData extends ChapterSummaryResult {}

/** Captured when the turn hands off; the chapter is built against this, whatever is open later. */
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
    storyId: string | undefined,
    entries: StoryEntry[],
    lastChapterEndIndex: number,
    config: MemoryConfig,
    tokensOutsideBuffer: number,
    mode?: StoryMode,
    pov?: POV,
    tense?: Tense,
    activityParentId?: string,
  ) => Promise<ChapterAnalysisResult>

  summarizeChapter: (
    storyId: string | undefined,
    entries: StoryEntry[],
    previousChapters?: Chapter[],
    mode?: StoryMode,
    pov?: POV,
    tense?: Tense,
    summaryDetail?: SummaryDetail,
    activityParentId?: string,
  ) => Promise<ChapterSummaryData>

  /** Writes the chapter to `scope`, which need not be the branch open when it lands. */
  addChapter: (chapter: Chapter, scope: BranchScope) => Promise<void>
}

/** Where the check decided to cut. */
export interface ChapterCut {
  /** The chapter's entries, as of the turn that cut it. */
  entries: StoryEntry[]
  /** Numbered from the chapters the turn started with. */
  number: number
  suggestedTitle?: string | null
}

export class ChapterService {
  private deps: ChapterServiceDependencies

  constructor(deps: ChapterServiceDependencies) {
    this.deps = deps
  }

  /** Whether this turn's check would ask the model anything at all. */
  isDue(input: ChapterCheckInput): boolean {
    const { tokensOutsideBuffer, memoryConfig } = input
    if (tokensOutsideBuffer === 0 || tokensOutsideBuffer < memoryConfig.tokenThreshold) {
      log('Tokens outside buffer below threshold, skipping', {
        tokensOutsideBuffer,
        tokenThreshold: memoryConfig.tokenThreshold,
      })
      return false
    }
    return this.selectableEnd(input) > input.lastChapterEndIndex
  }

  /** Ask whether to cut a chapter now, and where. Null when not yet. */
  async check(input: ChapterCheckInput, activityParentId?: string): Promise<ChapterCut | null> {
    const { entries, tokensOutsideBuffer, memoryConfig, mode, pov, tense } = input
    const startIndex = input.lastChapterEndIndex
    const maxSelectableEndIndex = this.selectableEnd(input)

    log('check', {
      tokensSinceLastChapter: input.tokensSinceLastChapter,
      tokensOutsideBuffer,
      tokenThreshold: memoryConfig.tokenThreshold,
      messagesOutsideBuffer: input.messagesSinceLastChapter - memoryConfig.chapterBuffer,
    })

    const analysis = await this.deps.analyzeForChapter(
      input.storyId,
      entries.slice(startIndex, maxSelectableEndIndex),
      input.lastChapterEndIndex,
      memoryConfig,
      tokensOutsideBuffer,
      mode,
      pov,
      tense,
      activityParentId,
    )

    if (!analysis.shouldCreateChapter) {
      log('No chapter needed yet')
      return null
    }

    // Chapter endpoints must stay outside the protected tail buffer.
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

    const chapterEntries = entries.slice(startIndex, clampedEndIndex)
    if (chapterEntries.length === 0) {
      log('No entries for chapter')
      return null
    }

    const highest = Math.max(0, ...input.currentBranchChapters.map((ch) => ch.number))
    return {
      entries: chapterEntries,
      number: highest + 1,
      suggestedTitle: analysis.suggestedTitle,
    }
  }

  /** Summarize the cut and add it as a chapter of the turn's story and branch. */
  async create(
    input: ChapterCheckInput,
    cut: ChapterCut,
    activityParentId?: string,
  ): Promise<Chapter> {
    const { mode, pov, tense, memoryConfig } = input
    const chapterEntries = cut.entries
    const previousChapters = [...input.currentBranchChapters].sort((a, b) => a.number - b.number)
    const summary = await this.deps.summarizeChapter(
      input.storyId,
      chapterEntries,
      previousChapters,
      mode,
      pov,
      tense,
      memoryConfig.summaryDetail,
      activityParentId,
    )

    const firstEntry = chapterEntries[0]
    const lastEntry = chapterEntries[chapterEntries.length - 1]
    const startTime = (firstEntry.metadata?.timeStart as TimeTracker | undefined) ?? null
    const endTime = (lastEntry.metadata?.timeEnd as TimeTracker | undefined) ?? null

    const chapter: Chapter = {
      id: crypto.randomUUID(),
      storyId: input.storyId,
      number: cut.number,
      title: cut.suggestedTitle ?? summary.title ?? null,
      startEntryId: firstEntry.id,
      endEntryId: lastEntry.id,
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

    await this.deps.addChapter(chapter, {
      storyId: input.storyId,
      branchId: input.currentBranchId,
    })
    log('Chapter created', { number: chapter.number, title: chapter.title })
    return chapter
  }

  private selectableEnd(input: ChapterCheckInput): number {
    const protectedCount = Math.max(0, input.memoryConfig.chapterBuffer)
    return Math.max(0, input.entries.length - protectedCount)
  }
}
