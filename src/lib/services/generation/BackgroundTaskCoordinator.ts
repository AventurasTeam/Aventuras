/**
 * BackgroundTaskCoordinator - Orchestrates post-response background tasks.
 * Runs style review and chapter check in parallel, then lore management
 * if chapter creation triggers it. Each task failure doesn't block others.
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
      this.styleScheduler.checkAndTrigger(input.styleReview, input.styleReviewCallbacks),
      this.chapterService.checkAndCreateChapter(input.chapterCheck),
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
