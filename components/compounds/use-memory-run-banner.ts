import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { CloseTask } from '@/lib/db'
import { t } from '@/lib/i18n'
import { CHAPTER_CLOSE_KIND, CLOSE_PHASE } from '@/lib/pipeline'
import {
  currentStoryStore,
  generationStore,
  interruptMemoryRuns,
  selectMemoryRun,
  type RunState,
} from '@/lib/stores'

export type MemoryRunBannerState = { label: string; onCancel: () => void }

const CLOSE_TASK_COPY = {
  happenings: 'chrome.memoryBanner.closeTask.happenings',
  lore: 'chrome.memoryBanner.closeTask.lore',
  identity: 'chrome.memoryBanner.closeTask.identity',
  threads: 'chrome.memoryBanner.closeTask.threads',
  upkeep: 'chrome.memoryBanner.closeTask.upkeep',
  lifecycle: 'chrome.memoryBanner.closeTask.lifecycle',
  awareness: 'chrome.memoryBanner.closeTask.awareness',
} as const satisfies Record<CloseTask, string>

/**
 * C6: a close's banner label. Before a turn it says so in any phase; else it names the phase, and in
 * `agent` the task last started. The run keeps `closeProgress` to its end; the label stops reading
 * it at `report`.
 */
export function closeBannerLabel(
  run: Pick<RunState, 'beforeTurn' | 'currentPhase' | 'closeProgress'>,
): string {
  if (run.beforeTurn) return t('chrome.memoryBanner.closingBeforeTurn')
  switch (run.currentPhase) {
    case CLOSE_PHASE.boundary:
      return t('chrome.memoryBanner.closingBoundary')
    case CLOSE_PHASE.metadata:
      return t('chrome.memoryBanner.closingMetadata')
    case CLOSE_PHASE.agent: {
      const progress = run.closeProgress
      if (progress == null) return t('chrome.memoryBanner.closingAgent')
      return t('chrome.memoryBanner.closingTask', {
        index: progress.index,
        total: progress.total,
        task: t(CLOSE_TASK_COPY[progress.task]),
      })
    }
    case CLOSE_PHASE.report:
      return t('chrome.memoryBanner.closingReport')
    default:
      return t('chrome.memoryBanner.closing')
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
 * The open branch's pass or close banner: its label and a Cancel that interrupts the run
 * (deferring it to the next Send). Null while neither runs there.
 */
export function useMemoryRunBanner(): MemoryRunBannerState | null {
  const branchId = currentStoryStore.useCurrentStory((open) => open?.branchId ?? null)
  // selectMemoryRun returns the stored run, so this selector is stable between writes.
  const run = generationStore.useGeneration((s) =>
    branchId == null ? undefined : selectMemoryRun(s.txState, { branchId }),
  )
  if (run == null) return null
  const label = bannerLabel(run)
  if (label == null) return null
  const runBranchId = run.branchId
  return { label, onCancel: () => void interruptMemoryRuns(runBranchId) }
}
