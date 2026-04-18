/**
 * BackgroundTaskCoordinator - Orchestrates post-response background tasks.
 * Runs style review and chapter check in parallel, then lore management
 * if chapter creation triggers it. Each task failure doesn't block others.
 */

import { ChapterService, type ChapterCreationResult } from './ChapterService'
import { LoreManagementCoordinator, type LoreSessionResult } from './LoreManagementCoordinator'
import {
  StyleReviewScheduler,
  type StyleReviewCheckInput,
  type StyleReviewCheckResult,
} from './StyleReviewScheduler'
import { story } from '$lib/stores/story/index.svelte'
import { createLogger } from '$lib/log'

const log = createLogger('BackgroundTaskCoordinator')

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
   * Run all background tasks: styleReview and chapterCheck in parallel
   * (they are independent), then lore management if chapter creation triggers it.
   */
  async runBackgroundTasks(input: BackgroundTaskInput): Promise<BackgroundTaskResult> {
    log('Starting background tasks')

    const result: BackgroundTaskResult = {
      styleReview: { triggered: false },
      chapterCreation: { created: false, loreManagementTriggered: false },
      loreManagement: null,
    }

    // 1. Style review and chapter check are independent - run in parallel
    const [styleSettled, chapterSettled] = await Promise.allSettled([
      this.styleScheduler.checkAndTrigger(input.styleReview),
      this.chapterService.checkAndCreateChapter(),
    ])

    if (styleSettled.status === 'fulfilled') {
      result.styleReview = styleSettled.value
      log('Style review complete', { triggered: result.styleReview.triggered })
    } else {
      log('Style review failed (non-fatal)', styleSettled.reason)
    }

    if (chapterSettled.status === 'fulfilled') {
      result.chapterCreation = chapterSettled.value
      log('Chapter check complete', {
        created: result.chapterCreation.created,
        loreManagementTriggered: result.chapterCreation.loreManagementTriggered,
      })
    } else {
      log('Chapter check failed (non-fatal)', chapterSettled.reason)
    }

    // 2. Lore management (only if chapter creation triggered it)
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
