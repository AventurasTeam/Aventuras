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
import { aiService } from '$lib/services/ai'
import { story } from '$lib/stores/story.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { ui } from '$lib/stores/ui.svelte'

function log(...args: unknown[]) {
  console.log('[BackgroundTaskCoordinator]', ...args)
}

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
   * Static convenience method that builds deps + input from stores and runs all background tasks.
   * Called from ActionInput after pipeline.execute() completes.
   */
  static async run(countStyleReview: boolean, styleReviewSource: string): Promise<void> {
    const storyId = story.currentStory?.id ?? ''
    const mode = story.currentStory?.mode ?? 'adventure'

    const deps: BackgroundTaskDependencies = {
      chapterService: {
        analyzeForChapter: aiService.analyzeForChapter.bind(aiService),
        summarizeChapter: aiService.summarizeChapter.bind(aiService),
        getNextChapterNumber: story.getNextChapterNumber.bind(story),
        addChapter: story.addChapter.bind(story),
      },
      loreManagement: {
        runLoreManagement: aiService.runLoreManagement.bind(aiService),
      },
      styleReview: { analyzeStyle: aiService.analyzeStyle.bind(aiService) },
    }

    const input: BackgroundTaskInput = {
      styleReview: {
        storyId,
        entries: story.entries,
        mode,
        pov: story.pov,
        tense: story.tense,
        enabled: settings.systemServicesSettings.styleReviewer.enabled,
        triggerInterval: settings.systemServicesSettings.styleReviewer.triggerInterval,
        currentCounter: ui.messagesSinceLastStyleReview,
        shouldIncrement: countStyleReview,
        source: styleReviewSource,
      },
      styleReviewCallbacks: {
        incrementCounter: ui.incrementStyleReviewCounter.bind(ui),
        setLoading: ui.setStyleReviewLoading.bind(ui),
        setResult: ui.setStyleReview.bind(ui),
      },
      chapterCheck: {
        storyId,
        currentBranchId: story.currentStory?.currentBranchId ?? null,
        entries: story.entries,
        lastChapterEndIndex: story.lastChapterEndIndex,
        tokensSinceLastChapter: story.tokensSinceLastChapter,
        tokensOutsideBuffer: story.tokensOutsideBuffer,
        messagesSinceLastChapter: story.messagesSinceLastChapter,
        memoryConfig: story.memoryConfig,
        currentBranchChapters: story.currentBranchChapters,
        mode,
        pov: story.pov,
        tense: story.tense,
      },
      loreSession: {
        storyId,
        currentBranchId: story.currentStory?.currentBranchId ?? null,
        lorebookEntries: story.lorebookEntries,
        chapters: story.currentBranchChapters,
        mode,
        pov: story.pov,
        tense: story.tense,
      },
      loreCallbacks: {
        onCreateEntry: async (entry) => {
          await story.addLorebookEntry(entry)
        },
        onUpdateEntry: story.updateLorebookEntry.bind(story),
        onDeleteEntry: story.deleteLorebookEntry.bind(story),
        onMergeEntries: async (entryIds, mergedEntry) => {
          await story.deleteLorebookEntries(entryIds)
          await story.addLorebookEntry(mergedEntry)
        },
        onQueryChapter: async (chapterNumber, question) => {
          return aiService.answerChapterQuestion(
            chapterNumber,
            question,
            story.currentBranchChapters,
          )
        },
      },
      loreUICallbacks: {
        onStart: ui.startLoreManagement.bind(ui),
        onProgress: ui.updateLoreManagementProgress.bind(ui),
        onComplete: ui.finishLoreManagement.bind(ui),
      },
    }

    if (!story.memoryConfig.autoSummarize) input.chapterCheck.tokensOutsideBuffer = 0

    const coordinator = new BackgroundTaskCoordinator(deps)
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
