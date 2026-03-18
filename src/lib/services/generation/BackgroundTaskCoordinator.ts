/**
 * BackgroundTaskCoordinator - Orchestrates post-response background tasks.
 * Runs style review, chapter check, and lore management in sequence.
 * Each task is independent - one failure doesn't block others.
 */

import {
  ChapterService,
  type ChapterServiceDependencies,
  type ChapterCheckInput,
  type ChapterCreationResult,
} from './ChapterService'
import {
  LoreManagementCoordinator,
  type LoreManagementDependencies,
  type LoreManagementCallbacks,
  type LoreManagementUICallbacks,
  type LoreSessionInput,
  type LoreSessionResult,
} from './LoreManagementCoordinator'
import {
  StyleReviewScheduler,
  type StyleReviewDependencies,
  type StyleReviewUICallbacks,
  type StyleReviewCheckInput,
  type StyleReviewCheckResult,
} from './StyleReviewScheduler'
import { createLogger } from '$lib/log'

const log = createLogger('BackgroundTaskCoordinator')

export interface BackgroundTaskDependencies {
  chapterService: ChapterServiceDependencies
  loreManagement: LoreManagementDependencies
  styleReview: StyleReviewDependencies
}

export interface BackgroundTaskInput {
  // Style review input
  styleReview: StyleReviewCheckInput
  styleReviewCallbacks?: StyleReviewUICallbacks

  // Chapter check input
  chapterCheck: ChapterCheckInput

  // Lore management input (used if chapter triggers lore management)
  loreSession: LoreSessionInput
  loreCallbacks: LoreManagementCallbacks
  loreUICallbacks?: LoreManagementUICallbacks
}

export interface BackgroundTaskResult {
  styleReview: StyleReviewCheckResult
  chapterCreation: ChapterCreationResult
  loreManagement: LoreSessionResult | null
}

export class BackgroundTaskCoordinator {
  private chapterService: ChapterService
  private loreCoordinator: LoreManagementCoordinator
  private styleScheduler: StyleReviewScheduler

  constructor(deps: BackgroundTaskDependencies) {
    this.chapterService = new ChapterService(deps.chapterService)
    this.loreCoordinator = new LoreManagementCoordinator(deps.loreManagement)
    this.styleScheduler = new StyleReviewScheduler(deps.styleReview)
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
      result.styleReview = await this.styleScheduler.checkAndTrigger(
        input.styleReview,
        input.styleReviewCallbacks,
      )
      log('Style review complete', { triggered: result.styleReview.triggered })
    } catch (error) {
      log('Style review failed (non-fatal)', error)
    }

    // 2. Chapter check
    try {
      result.chapterCreation = await this.chapterService.checkAndCreateChapter(input.chapterCheck)
      log('Chapter check complete', {
        created: result.chapterCreation.created,
        loreManagementTriggered: result.chapterCreation.loreManagementTriggered,
      })
    } catch (error) {
      log('Chapter check failed (non-fatal)', error)
    }

    // 3. Lore management (only if chapter creation triggered it)
    if (result.chapterCreation.loreManagementTriggered) {
      try {
        result.loreManagement = await this.loreCoordinator.runSession(
          input.loreSession,
          input.loreCallbacks,
          input.loreUICallbacks,
        )
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
