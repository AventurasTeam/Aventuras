import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { closeTaskLabel } from '@/lib/history'
import { t } from '@/lib/i18n'
import { CHAPTER_CLOSE_KIND, CLOSE_PHASE } from '@/lib/pipeline'
import {
  chapterOverlaysStore,
  chaptersStore,
  closeResultChapter,
  currentStoryStore,
  generationStore,
  interruptMemoryRuns,
  selectMemoryRun,
  type RunState,
} from '@/lib/stores'

export type MemoryRunBannerState =
  | { kind: 'run'; label: string; onCancel: () => void }
  | {
      kind: 'closed'
      tone: 'info' | 'warning'
      label: string
      onReview: () => void
      onDismiss: () => void
    }

/**
 * C6: a close's banner label; in `agent` it names the task last started. The run keeps
 * `closeProgress` to its end; the label stops reading it at `report`. Under Send each label
 * says the wait is for the user's turn, the only place it says so on phone.
 */
export function closeBannerLabel(
  run: Pick<RunState, 'beforeTurn' | 'currentPhase' | 'closeProgress'>,
): string {
  const turn = run.beforeTurn
  switch (run.currentPhase) {
    case CLOSE_PHASE.boundary:
      return t(
        turn ? 'chrome.memoryBanner.beforeTurnBoundary' : 'chrome.memoryBanner.closingBoundary',
      )
    case CLOSE_PHASE.metadata:
      return t(
        turn ? 'chrome.memoryBanner.beforeTurnMetadata' : 'chrome.memoryBanner.closingMetadata',
      )
    case CLOSE_PHASE.agent: {
      const progress = run.closeProgress
      if (progress == null)
        return t(turn ? 'chrome.memoryBanner.beforeTurnAgent' : 'chrome.memoryBanner.closingAgent')
      return t(turn ? 'chrome.memoryBanner.beforeTurnTask' : 'chrome.memoryBanner.closingTask', {
        index: progress.index,
        total: progress.total,
        task: closeTaskLabel(progress.task),
      })
    }
    case CLOSE_PHASE.report:
      return t(turn ? 'chrome.memoryBanner.beforeTurnReport' : 'chrome.memoryBanner.closingReport')
    default:
      return t(turn ? 'chrome.memoryBanner.closingBeforeTurn' : 'chrome.memoryBanner.closing')
  }
}

function bannerLabel(run: RunState): string | null {
  if (run.kind === PERIODIC_CLASSIFIER_KIND)
    return run.beforeTurn
      ? t('chrome.memoryBanner.updatingBeforeTurn')
      : t('chrome.memoryBanner.updating')
  if (run.kind === CHAPTER_CLOSE_KIND) return closeBannerLabel(run)
  return null
}

/**
 * The open branch's pass or close while one runs, its Cancel interrupting the run (deferring it to
 * the next Send); else the close it last committed in this open, until reviewed, dismissed or
 * reversed.
 * The result shows only while its chapter is the branch's latest, so an older close never reads as
 * current.
 */
export function useMemoryRunBanner(): MemoryRunBannerState | null {
  const branchId = currentStoryStore.useCurrentStory((open) => open?.branchId ?? null)
  // selectMemoryRun returns the stored run, so this selector is stable between writes.
  const run = generationStore.useGeneration((s) =>
    branchId == null ? undefined : selectMemoryRun(s.txState, { branchId }),
  )
  const openSeq = currentStoryStore.useOpenSeq()
  const result = chapterOverlaysStore.useOverlays((s) => s.closeResult)
  const held = chaptersStore.useChapters((rows) =>
    closeResultChapter(result, rows, { branchId, openSeq }),
  )
  const latestChapter = chaptersStore.useChapters(chaptersStore.selectLatest)

  const label = run == null ? null : bannerLabel(run)
  if (run != null && label != null) {
    const runBranchId = run.branchId
    return { kind: 'run', label, onCancel: () => void interruptMemoryRuns(runBranchId) }
  }

  if (result == null || held == null || held.id !== latestChapter?.id) return null
  const { chapterId, stoppedTasks } = result
  const clear = () => chapterOverlaysStore.clearCloseResult()
  return {
    kind: 'closed',
    tone: stoppedTasks === 0 ? 'info' : 'warning',
    label:
      stoppedTasks === 0
        ? t('chrome.closeResult.closed', { title: held.title })
        : t('chrome.closeResult.stopped', { count: stoppedTasks }),
    onReview: () => {
      chapterOverlaysStore.openReviewWindow({ chapterId })
      clear()
    },
    onDismiss: clear,
  }
}
