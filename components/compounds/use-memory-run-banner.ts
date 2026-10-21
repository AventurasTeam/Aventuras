import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { t } from '@/lib/i18n'
import {
  currentStoryStore,
  generationStore,
  interruptMemoryRuns,
  selectMemoryRun,
} from '@/lib/stores'

export type MemoryRunBannerState = { label: string; onCancel: () => void }

/**
 * The open branch's pass banner: its label and a Cancel that interrupts the pass (deferring it to
 * the next Send). Null while no pass runs there.
 */
export function useMemoryRunBanner(): MemoryRunBannerState | null {
  const branchId = currentStoryStore.useCurrentStory((open) => open?.branchId ?? null)
  // selectMemoryRun returns the stored run, so this selector is stable between writes.
  const run = generationStore.useGeneration((s) =>
    branchId == null ? undefined : selectMemoryRun(s.txState, { branchId }),
  )
  if (run == null || run.kind !== PERIODIC_CLASSIFIER_KIND) return null
  const runBranchId = run.branchId
  return {
    label: run.beforeTurn
      ? t('chrome.memoryBanner.updatingBeforeTurn')
      : t('chrome.memoryBanner.updating'),
    onCancel: () => void interruptMemoryRuns(runBranchId),
  }
}
