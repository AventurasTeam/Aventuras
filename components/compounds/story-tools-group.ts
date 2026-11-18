import type { ActionGroup } from '@/components/compounds/actions-menu'
import { t } from '@/lib/i18n'
import type { CloseModalRequest } from '@/lib/stores'

export type StoryToolsInput = {
  branchId: string
  canClose: boolean
  /** The run gate's reason while it holds; the entry disables with it. */
  gateReason: string | undefined
  openCloseModal: (request: CloseModalRequest) => void
}

/** actions-menu.md → Curated core; undefined when no entry applies here. */
export function buildStoryToolsGroup(input: StoryToolsInput): ActionGroup | undefined {
  // actions-menu.md → Gating: nothing to end the chapter on hides it; a run in flight disables it.
  if (!input.canClose) return undefined
  const { branchId, gateReason, openCloseModal } = input
  return {
    id: 'story-tools',
    header: t('chrome.storyTools.header'),
    entries: [
      {
        id: 'close-chapter',
        label: t('chrome.storyTools.closeChapter'),
        disabled: gateReason != null,
        disabledReason: gateReason,
        onActivate: () => openCloseModal({ branchId }),
      },
    ],
  }
}
