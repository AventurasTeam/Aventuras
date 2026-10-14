/**
 * BackgroundTaskCoordinator - Orchestrates post-response background tasks.
 *
 * Two stages. The turn's: style review and chapter check in parallel, recorded in the turn's
 * record. The chapter creation card's, only when the check cut a chapter: the summary, then lore
 * management, recorded in the card's own record. Each task failure doesn't block others.
 */

import {
  ChapterService,
  type ChapterServiceDependencies,
  type ChapterCheckInput,
  type ChapterCut,
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
import type { Chapter } from '#lib/types/index.ts'
import type { ChapterCards } from '#lib/services/chapterCreation/index.ts'
import {
  describeActivityError,
  failStep,
  NO_ACTIVITY,
  type ActivityReporter,
} from '#lib/services/activity/index.ts'
import { createLogger } from '#lib/log.ts'

const log = createLogger('BackgroundTaskCoordinator')

export interface BackgroundTaskDependencies {
  chapterService: ChapterServiceDependencies
  loreManagement: LoreManagementDependencies
  styleReview: StyleReviewDependencies
}

/** Where a cut chapter's card and its record go. */
export interface ChapterCardReporting {
  cards: ChapterCards
  /** The narration the card sits after. */
  anchorEntryId: string
  /** Opens the card's record by its key. Returns its id, or `''` when nothing is recorded. */
  openRecord: (key: string) => string
  /** Opens it again, for a retried summary. */
  reopenRecord: (key: string) => string
  closeRecord: (id: string) => void
  /**
   * Whether the cut can still become a chapter. `open`: its branch is open and its entries are
   * still the first ones no chapter covers. `busy`: another chapter check or card on the branch
   * is running and may cut them first. `closed`: the span was cut, changed or left.
   */
  cutState: (cut: ChapterCut) => 'open' | 'busy' | 'closed'
}

/** Why a retry was not made: the span was cut, changed or left since the summary failed. */
export const CUT_NO_LONGER_OPEN =
  "This chapter's entries have changed or been cut since; a later turn will cut them again"

/** Why a retry was put off: another chapter on the branch is being checked or written. */
export const CUT_BUSY =
  'Another chapter is being checked or written on this branch; retry once it is done'

export interface BackgroundTaskInput {
  // Style review input
  styleReview: StyleReviewCheckInput
  styleReviewCallbacks?: StyleReviewUICallbacks

  // Chapter check input
  chapterCheck: ChapterCheckInput

  // Lore management input (used if chapter triggers lore management)
  /**
   * Built when lore management is about to run, not when the turn started.
   *
   * Everything in it moves during the turn: the classifier writes entries, and the chapter
   * check that decides whether lore management runs at all creates the chapter. A snapshot
   * taken up front handed the agent a lorebook without the entries just classified, a
   * chapter list without the chapter that triggered it, and a "recent story" still holding
   * the entries that chapter had just absorbed.
   *
   * Throws when the turn's story and branch are no longer open; lore management then does
   * not run.
   */
  loreSession: () => LoreSessionInput
  loreCallbacks: LoreManagementCallbacks
  loreUICallbacks?: LoreManagementUICallbacks

  /** Records both stages. Absent, nothing is recorded. */
  activity?: ActivityReporter
  /** The turn's *After the turn* step, which the turn's own work nests under. */
  activityParentId?: string
  /** Called once the turn's work has settled; a chapter creation it handed off may still run. */
  onTurnWorkEnded?: (recordedAnything: boolean) => void
  /** Whether the chapter check is asking the model, for the story view to say so. */
  onChapterCheck?: (active: boolean) => void
  chapterCard?: ChapterCardReporting
}

export interface BackgroundTaskResult {
  styleReview: StyleReviewCheckResult
  chapterCreation: { created: boolean; chapter?: Chapter }
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

  async runBackgroundTasks(input: BackgroundTaskInput): Promise<BackgroundTaskResult> {
    log('Starting background tasks')

    const result: BackgroundTaskResult = {
      styleReview: { triggered: false },
      chapterCreation: { created: false },
      loreManagement: null,
    }

    // Started the moment the check cuts, not once the style review is done too.
    let creation: Promise<void> | null = null
    let recordedAnything = false
    try {
      const turn = await this.runTurnWork(input, (cut) => {
        creation = this.createChapter(input, cut, result).catch((error) =>
          log('Chapter creation failed (non-fatal)', error),
        )
      })
      result.styleReview = turn.styleReview
      recordedAnything = turn.recordedAnything
    } finally {
      input.onTurnWorkEnded?.(recordedAnything)
    }

    if (creation) await creation

    log('Background tasks complete')
    return result
  }

  /** Style review and chapter check, independent of each other, in the turn's record. */
  private async runTurnWork(input: BackgroundTaskInput, onCut: (cut: ChapterCut) => void) {
    // An empty parent would put the steps at the root of the newest turn.
    const parentId = input.activityParentId || undefined
    const activity = parentId && input.activity ? input.activity : NO_ACTIVITY
    const checkDue = this.chapterService.isDue(input.chapterCheck)
    let checkStepId = ''

    const [styleSettled, chapterSettled] = await Promise.allSettled([
      this.styleScheduler.checkAndTrigger(
        input.styleReview,
        input.styleReviewCallbacks,
        parentId ? { activity, parentId } : undefined,
      ),
      (async () => {
        if (!checkDue) return null
        checkStepId = activity.startStep('Chapter check', { parentId, isLLM: true })
        input.onChapterCheck?.(true)
        try {
          const found = await this.chapterService.check(
            input.chapterCheck,
            checkStepId || undefined,
          )
          if (found) {
            activity.recordStep(`Chapter ${found.number} handed off`, { parentId: checkStepId })
            activity.endStep(checkStepId, 'done', `cut ${found.entries.length} entries`)
            onCut(found)
          } else {
            activity.endStep(checkStepId, 'done', 'not yet')
          }
          return found
        } finally {
          input.onChapterCheck?.(false)
        }
      })(),
    ])

    let styleReview: StyleReviewCheckResult = { triggered: false }
    if (styleSettled.status === 'fulfilled') {
      styleReview = styleSettled.value
      log('Style review complete', { triggered: styleReview.triggered })
    } else {
      log('Style review failed (non-fatal)', styleSettled.reason)
    }

    if (chapterSettled.status === 'fulfilled') {
      log('Chapter check complete', { cut: !!chapterSettled.value })
    } else {
      failStep(activity, checkStepId, chapterSettled.reason)
      log('Chapter check failed (non-fatal)', chapterSettled.reason)
    }

    const recordedAnything = checkDue || styleReview.triggered || !!styleReview.failed
    return { styleReview, recordedAnything }
  }

  /** The summary, then lore management, reported by the chapter creation card. */
  private async createChapter(
    input: BackgroundTaskInput,
    cut: ChapterCut,
    result: BackgroundTaskResult,
  ) {
    const { chapterCheck } = input
    const reporting = input.chapterCard
    const card = reporting?.cards.start({
      storyId: chapterCheck.storyId,
      branchId: chapterCheck.currentBranchId,
      anchorEntryId: reporting.anchorEntryId,
      number: cut.number,
    })
    const recordId = card && reporting ? reporting.openRecord(card.recordKey) : ''
    await this.runCreation(input, cut, result, card?.id, recordId, 1)
  }

  /** One summary run and, when it succeeds, lore management. A failed summary can call it again. */
  private async runCreation(
    input: BackgroundTaskInput,
    cut: ChapterCut,
    result: BackgroundTaskResult,
    cardId: string | undefined,
    recordId: string,
    run: number,
  ) {
    const { chapterCheck } = input
    const reporting = input.chapterCard
    const card = cardId ? reporting?.cards.get(cardId) : undefined
    const activity = recordId && input.activity ? input.activity : NO_ACTIVITY

    try {
      const label = run === 1 ? 'Chapter summary' : `Chapter summary (run ${run})`
      const summaryId = activity.startStep(label, { recordId, isLLM: true })
      let chapter: Chapter
      try {
        chapter = await this.chapterService.create(chapterCheck, cut, summaryId || undefined)
      } catch (error) {
        failStep(activity, summaryId, error)
        log('Chapter creation failed (non-fatal)', error)
        if (card && reporting) {
          const retry = async (): Promise<void> => {
            const state = reporting.cutState(cut)
            if (state === 'busy') {
              reporting.cards.summaryFailed(card.id, CUT_BUSY, retry, false)
              return
            }
            if (state === 'closed') {
              reporting.cards.summaryFailed(card.id, CUT_NO_LONGER_OPEN, undefined, false)
              return
            }
            reporting.cards.summaryRestarted(card.id)
            const reopened = reporting.reopenRecord(card.recordKey)
            await this.runCreation(input, cut, result, card.id, reopened, run + 1)
          }
          reporting.cards.summaryFailed(card.id, describeActivityError(error), retry)
        }
        return
      }
      activity.endStep(summaryId)
      result.chapterCreation = { created: true, chapter }
      if (card) reporting?.cards.summarized(card.id, chapter)

      const lore = await this.runLore(input, chapter, cut, activity, recordId)
      result.loreManagement = lore
      log('Lore management complete', { completed: lore.completed, changeCount: lore.changeCount })
      if (!card) return
      if (lore.completed) reporting?.cards.loreFinished(card.id)
      else {
        reporting?.cards.loreIncomplete(
          card.id,
          lore.error ?? 'Lore management did not complete',
          lore.changeCount,
        )
      }
    } finally {
      if (recordId) reporting?.closeRecord(recordId)
    }
  }

  private async runLore(
    input: BackgroundTaskInput,
    chapter: Chapter,
    cut: ChapterCut,
    activity: ActivityReporter,
    recordId: string,
  ): Promise<LoreSessionResult> {
    let session: LoreSessionInput
    try {
      session = input.loreSession()
    } catch (error) {
      const reason = describeActivityError(error)
      activity.recordStep('Lore management', { recordId, status: 'failed', error: reason })
      log('Lore management not started', error)
      return { completed: false, changeCount: 0, error: reason }
    }
    try {
      return await this.loreCoordinator.runSession(
        { ...session, newChapter: { chapter, entries: cut.entries } },
        input.loreCallbacks,
        input.loreUICallbacks,
        recordId ? { activity, placement: { recordId } } : undefined,
      )
    } catch (error) {
      log('Lore management failed (non-fatal)', error)
      return { completed: false, changeCount: 0, error: describeActivityError(error) }
    }
  }
}
