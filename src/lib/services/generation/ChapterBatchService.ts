/**
 * ChapterBatchService - Orchestrates batch chapterization of a pre-existing
 * entry history (e.g. after a SillyTavern import). Boundaries are precomputed
 * deterministically by ChapterBatchPlanner.
 *
 * Runs sequentially chapter-by-chapter:
 * 1. For each chapter:
 *    a. Creates the chapter (strictly sequential summary generation).
 *    b. Estimates the timeline duration and assigns the timeline bracket (sequential).
 *    c. Runs classification to update characters/locations/items (sequential).
 * 2. After all chapters are processed, runs a single lore management pass
 *    over the whole batch to update lorebook entries.
 *
 * Running sequentially prevents rate limits, keeps code simple, and ensures
 * each step receives the updated entity and time state from the previous chapter.
 */

import type { Chapter, Entry, StoryEntry, StoryMode, POV, Tense, TimeTracker } from '$lib/types'
import type { ClassificationResult } from '$lib/services/ai/sdk'
import { planChapterBoundaries } from './ChapterBatchPlanner'
import {
  LoreManagementCoordinator,
  type LoreManagementDependencies,
  type LoreManagementCallbacks,
  type LoreManagementUICallbacks,
} from './LoreManagementCoordinator'
import { createLogger } from '$lib/log'

const log = createLogger('ChapterBatchService')

export interface ChapterBatchServiceDependencies {
  buildAndSaveChapter: (startIndex: number, endIndex: number) => Promise<Chapter>
  runLoreManagement: LoreManagementDependencies['runLoreManagement']
  estimateChapterTimeline: (summary: string) => Promise<TimeTracker>
  getTimeTracker: () => TimeTracker
  setTimeTracker: (time: TimeTracker) => Promise<void>
  updateChapterTimes: (
    chapterId: string,
    startTime: TimeTracker,
    endTime: TimeTracker,
  ) => Promise<void>
  getChapterEntries: (chapter: Chapter) => StoryEntry[]
  classifyChapter: (content: string, currentTime: TimeTracker) => Promise<ClassificationResult>
  applyClassificationResult: (result: ClassificationResult) => Promise<void>
}

export interface ChapterBatchInput {
  entries: StoryEntry[]
  startIndex: number
  tokenThreshold: number
  chapterBuffer: number
  includeLorebook: boolean
  includeTimeline: boolean
  includeClassification: boolean
  storyId: string
  currentBranchId: string | null
  lorebookEntries: Entry[]
  mode: StoryMode
  pov: POV
  tense: Tense
}

export interface ChapterBatchCallbacks {
  isCancelled: () => boolean
  onChapterProgress: (current: number, total: number) => void
  onTimelineProgress?: (current: number, total: number) => void
  onClassificationProgress?: (current: number, total: number) => void
  loreCallbacks: LoreManagementCallbacks
  loreUICallbacks?: LoreManagementUICallbacks
}

export interface ChapterBatchResult {
  chapters: Chapter[]
  cancelled: boolean
}

export class ChapterBatchService {
  private deps: ChapterBatchServiceDependencies

  constructor(deps: ChapterBatchServiceDependencies) {
    this.deps = deps
  }

  async run(
    input: ChapterBatchInput,
    callbacks: ChapterBatchCallbacks,
  ): Promise<ChapterBatchResult> {
    const boundaries = planChapterBoundaries(
      input.entries,
      input.tokenThreshold,
      input.chapterBuffer,
      input.startIndex,
    )

    log('Batch planned', { boundaryCount: boundaries.length, startIndex: input.startIndex })

    const chapters: Chapter[] = []
    let time = this.deps.getTimeTracker()
    const totalChapters = boundaries.length

    callbacks.onChapterProgress(0, totalChapters)

    for (let i = 0; i < boundaries.length; i++) {
      if (callbacks.isCancelled()) {
        log('Batch cancelled during execution', {
          chaptersCreated: chapters.length,
          planned: totalChapters,
        })
        return { chapters, cancelled: true }
      }

      const boundary = boundaries[i]

      // 1. Generate and save chapter
      let chapter = await this.deps.buildAndSaveChapter(boundary.startIndex, boundary.endIndex)
      chapters.push(chapter)
      const chapterIndex = chapters.length - 1
      callbacks.onChapterProgress(chapters.length, totalChapters)

      // 2. Timeline (sequential)
      if (input.includeTimeline) {
        callbacks.onTimelineProgress?.(chapterIndex, totalChapters)
        const delta = await this.deps.estimateChapterTimeline(chapter.summary)
        const startTime = time
        await this.deps.setTimeTracker({
          years: startTime.years + delta.years,
          days: startTime.days + delta.days,
          hours: startTime.hours + delta.hours,
          minutes: startTime.minutes + delta.minutes,
        })
        time = this.deps.getTimeTracker()
        await this.deps.updateChapterTimes(chapter.id, startTime, time)
        chapter = { ...chapter, startTime, endTime: time }
        chapters[chapterIndex] = chapter
        callbacks.onTimelineProgress?.(chapterIndex + 1, totalChapters)
      }

      // 3. Classification (sequential)
      if (input.includeClassification) {
        callbacks.onClassificationProgress?.(chapterIndex, totalChapters)
        const rawText = this.deps
          .getChapterEntries(chapter)
          .map((e) => `[${e.type}]: ${e.content}`)
          .join('\n\n')
        const content = `Chapter summary: ${chapter.summary}\n\nFull chapter content:\n${rawText}`
        const currentTime = chapter.endTime ?? this.deps.getTimeTracker()
        const result = await this.deps.classifyChapter(content, currentTime)
        result.scene.timeProgression = 'none'
        await this.deps.applyClassificationResult(result)
        callbacks.onClassificationProgress?.(chapterIndex + 1, totalChapters)
      }
    }

    if (chapters.length === 0) {
      return { chapters, cancelled: false }
    }

    if (callbacks.isCancelled()) {
      log('Batch cancelled before lore management phase', { chaptersCreated: chapters.length })
      return { chapters, cancelled: true }
    }

    // Phase 4: lore management, a single pass over the whole batch.
    if (input.includeLorebook) {
      log('Running single lore management pass over batch', { chapterCount: chapters.length })
      const coordinator = new LoreManagementCoordinator({
        runLoreManagement: this.deps.runLoreManagement,
      })
      await coordinator.runSession(
        {
          storyId: input.storyId,
          currentBranchId: input.currentBranchId,
          lorebookEntries: input.lorebookEntries,
          chapters,
          mode: input.mode,
          pov: input.pov,
          tense: input.tense,
        },
        callbacks.loreCallbacks,
        callbacks.loreUICallbacks,
      )
    }

    return { chapters, cancelled: false }
  }
}
