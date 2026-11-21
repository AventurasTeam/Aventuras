import { useStoryGenerationGate } from '@/components/story-settings/generation-run'
import { useChapterProgress } from '@/hooks/use-chapter-progress'
import { isCloseOwed } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { currentStoryStore, generationStore } from '@/lib/stores'

/** The run in flight names itself first; a close owed asks for it before any re-run. */
export function rerunDisabledReason(
  gateReason: string | undefined,
  closeOwed: boolean,
): string | undefined {
  return gateReason ?? (closeOwed ? t('chapters:actions.closeOpenFirst') : undefined)
}

/** Why `Re-run close…`, `Re-run…` and the re-run confirm disable on `branchId`; undefined while one may start. */
export function useRerunDisabledReason(
  storyId: string | undefined,
  branchId: string,
): string | undefined {
  const { gateReason } = useStoryGenerationGate(storyId, branchId)
  const progress = useChapterProgress(storyId)
  const autoClose = currentStoryStore.useCurrentStory(
    (open) => open != null && open.storyId === storyId && open.settings.chapterAutoClose,
  )
  const manualPending = generationStore.useGeneration((s) => s.txState.pendingClose.has(branchId))
  return rerunDisabledReason(gateReason, isCloseOwed(progress, autoClose, manualPending))
}
