import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { closeTaskLabel } from '@/lib/history'
import { t } from '@/lib/i18n'
import { CHAPTER_CLOSE_KIND, CLOSE_PHASE } from '@/lib/pipeline'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  generationStore,
  interruptMemoryRuns,
  selectMemoryRun,
  useCloseResultChapter,
  type CloseResult,
  type RunState,
  type StoreChapter,
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
 * says the wait is for the user's turn, the only place it says so on phone. A re-run names its
 * reversal; its boundary and metadata neither choose an end nor write a summary.
 */
export function closeBannerLabel(
  run: Pick<RunState, 'beforeTurn' | 'currentPhase' | 'closeProgress' | 'interruptible'>,
): string {
  if (run.interruptible === 'rerun') {
    if (run.currentPhase === CLOSE_PHASE.reversal) return t('chrome.memoryBanner.closingReversal')
    if (run.currentPhase === CLOSE_PHASE.boundary || run.currentPhase === CLOSE_PHASE.metadata)
      return t('chrome.memoryBanner.closing')
  }
  const turn = run.beforeTurn
  switch (run.currentPhase) {
    case CLOSE_PHASE.boundary:
      return t(
        turn ? 'chrome.memoryBanner.beforeTurnBoundary' : 'chrome.memoryBanner.closingBoundary',
      )
    // A close's reversal returns at once, so the metadata label stands through it.
    case CLOSE_PHASE.metadata:
    case CLOSE_PHASE.reversal:
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

function closedLabel(
  result: CloseResult,
  chapter: Pick<StoreChapter, 'title' | 'sequenceNumber'>,
): string {
  if (result.rerun) return t('chrome.closeResult.rerun', { number: chapter.sequenceNumber })
  return result.stoppedTasks === 0
    ? t('chrome.closeResult.closed', { title: chapter.title })
    : t('chrome.closeResult.stopped', { count: result.stoppedTasks })
}

/**
 * The open branch's running pass, close or re-run (Cancel defers a pass or close to the next Send,
 * a re-run nothing); else its last close or re-run of this open until reviewed, dismissed or
 * reversed, only while that chapter is the latest.
 */
export function useMemoryRunBanner(): MemoryRunBannerState | null {
  const branchId = currentStoryStore.useCurrentStory((open) => open?.branchId ?? null)
  // selectMemoryRun returns the stored run, so this selector is stable between writes.
  const run = generationStore.useGeneration((s) =>
    branchId == null ? undefined : selectMemoryRun(s.txState, { branchId }),
  )
  const openSeq = currentStoryStore.useOpenSeq()
  const result = chapterOverlaysStore.useOverlays((s) => s.closeResult)
  const held = useCloseResultChapter(result, { branchId, openSeq })
  const latestChapter = chaptersStore.useChapters(branchId, chaptersStore.selectLatest)

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
    label: closedLabel(result, held),
    onReview: () => {
      if (chapterOverlaysStore.openReviewWindow({ chapterId })) clear()
    },
    onDismiss: clear,
  }
}
