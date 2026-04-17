/**
 * BackgroundTaskCoordinator - Orchestrates post-response background tasks.
 * Runs style review, chapter check, and lore management in sequence.
 * Each task is independent - one failure doesn't block others.
 */

import { ChapterService, type ChapterCreationResult } from './ChapterService'
import { LoreManagementCoordinator, type LoreSessionResult } from './LoreManagementCoordinator'
import {
  StyleReviewScheduler,
  type StyleReviewCheckInput,
  type StyleReviewCheckResult,
} from './StyleReviewScheduler'
import { story } from '$lib/stores/story/index.svelte'

function log(...args: unknown[]) {
  console.log('[BackgroundTaskCoordinator]', ...args)
}

export interface BackgroundTaskInput {
  // Style review input
  styleReview: StyleReviewCheckInput
  shouldCheckChapter: boolean
}

export interface BackgroundTaskResult {
  styleReview: StyleReviewCheckResult
  chapterCreation: ChapterCreationResult
  loreManagement: LoreSessionResult | null
}

export class BackgroundTaskCoordinator {
  private chapterService = new ChapterService()
  private loreCoordinator = new LoreManagementCoordinator()
  private styleScheduler = new StyleReviewScheduler()

  /**
   * Static convenience method that builds deps + input from stores and runs all background tasks.
   * Called from ActionInput after pipeline.execute() completes.
   */
  static async run(countStyleReview: boolean, styleReviewSource: string): Promise<void> {
    const input: BackgroundTaskInput = {
      styleReview: {
        shouldIncrement: countStyleReview,
        source: styleReviewSource,
      },
      shouldCheckChapter: true,
    }

    if (!story.settings.memoryConfig.autoSummarize) {
      input.shouldCheckChapter = false
    }

    const coordinator = new BackgroundTaskCoordinator()
    await coordinator.runBackgroundTasks(input)
  }

  /**
   * Run all background tasks in order: styleReview, chapterCheck (which may trigger lore).
   * Each task is independent - errors are logged but don't stop other tasks.
   */
  async runBackgroundTasks(input: BackgroundTaskInput): Promise<BackgroundTaskResult> {
    log('Starting background tasks')

    const result: BackgroundTaskResult = {
      styleReview: { triggered: false },
      chapterCreation: { created: false, loreManagementTriggered: false },
      loreManagement: null,
    }

    // 1. Style review (runs first, independent)
    try {
      result.styleReview = await this.styleScheduler.checkAndTrigger(input.styleReview)
      log('Style review complete', { triggered: result.styleReview.triggered })
    } catch (error) {
      log('Style review failed (non-fatal)', error)
    }

    // 2. Chapter check
    if (input.shouldCheckChapter) {
      try {
        result.chapterCreation = await this.chapterService.checkAndCreateChapter()
        log('Chapter check complete', {
          created: result.chapterCreation.created,
          loreManagementTriggered: result.chapterCreation.loreManagementTriggered,
        })
      } catch (error) {
        log('Chapter check failed (non-fatal)', error)
      }
    }

    // 3. Lore management (only if chapter creation triggered it)
    if (result.chapterCreation.loreManagementTriggered) {
      try {
        result.loreManagement = await this.loreCoordinator.runSession()
        log('Lore management complete', {
          completed: result.loreManagement.completed,
          changeCount: result.loreManagement.changeCount,
        })
      } catch (error) {
        log('Lore management failed (non-fatal)', error)
        result.loreManagement = { completed: false, changeCount: 0 }
      }
    }

    log('Background tasks complete')
    return result
  }
}
