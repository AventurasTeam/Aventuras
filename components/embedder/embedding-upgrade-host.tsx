import { useRouter, type Href } from 'expo-router'
import { useCallback, useState } from 'react'

import {
  declineEmbeddingUpgrade,
  StorySettingsStaleStoreError,
  StorySettingsUnreadableError,
  type DeclineEmbeddingUpgradeFn,
} from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  dismissUpgradePrompt,
  embeddingUpgradePromptOpen,
  latchUpgradePrompt,
  UPGRADE_PROMPT_LATCH_INITIAL,
  upgradePromptShown,
} from '@/lib/embedder-swap'
import { t } from '@/lib/i18n'
import {
  appSettingsStore,
  currentStoryStore,
  embedderSwapStore,
  openEmbedderSwapDialog,
  recoveryReportStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

import { EmbeddingUpgradeDialog } from './embedding-upgrade-dialog'

const ctx = { db, runInTransaction }

const declineStoryUpgrade: DeclineEmbeddingUpgradeFn = (storyId, declinedModelId) =>
  declineEmbeddingUpgrade(storyId, declinedModelId, ctx)

type EmbeddingUpgradeHostProps = {
  /** Injectable seam for stories/tests — defaults to lib/actions' declineEmbeddingUpgrade. */
  declineUpgrade?: DeclineEmbeddingUpgradeFn
  /** Injectable seam for stories/tests — defaults to expo-router's `router.navigate`. */
  navigate?: (href: Href) => void
}

/**
 * The ONE mount of the upgrade prompt, beside SwapResumeHost. Keyed on the story-open
 * event, not merely the open story: every `openStory` call reads the gate once, so a
 * default changed mid-session waits for the next open, and route hydration (reload,
 * deep link, branch switch) is not an open. A swap marker or an unacknowledged
 * recovery report at the open drops the prompt for that open; it is not queued.
 */
export function EmbeddingUpgradeHost({
  declineUpgrade = declineStoryUpgrade,
  navigate,
}: EmbeddingUpgradeHostProps) {
  const storyId = currentStoryStore.useCurrentStory((open) => open?.storyId ?? null)
  const storyModelId = currentStoryStore.useCurrentStory(
    (open) => open?.settings.embedding_model_id ?? null,
  )
  const swapTarget = currentStoryStore.useCurrentStory(
    (open) => open?.settings.embedding_swap_target ?? null,
  )
  const declined = currentStoryStore.useCurrentStory(
    (open) => open?.settings.embedding_upgrade_declined ?? null,
  )
  const openSeq = currentStoryStore.useOpenSeq()
  const appDefault = appSettingsStore.useAppSettings((s) => s.embeddingModelId)
  const swapRunning = embedderSwapStore.useSwap(
    (s) => embedderSwapStore.progressFor(s, storyId) != null,
  )
  const deferred = embedderSwapStore.useSwap(
    (s) => storyId != null && s.upgradeDeferred.has(storyId),
  )
  const recoveryActive = recoveryReportStore.useRecoveryReport(
    (s) => s.activeRecoveryReport != null || s.pendingRecoveryReport != null,
  )

  const gateOpen = embeddingUpgradePromptOpen({
    storyId,
    storyModelId,
    swapTarget,
    declined,
    appDefault,
    swapRunning,
    deferred,
    recoveryActive,
  })

  const [latch, setLatch] = useState(UPGRADE_PROMPT_LATCH_INITIAL)
  const latched = latchUpgradePrompt(latch, openSeq, gateOpen)
  if (latched !== latch) setLatch(latched)
  const open = upgradePromptShown(latched, openSeq, gateOpen)

  const router = useRouter()

  const onUpgrade = useCallback(() => {
    if (storyId == null || appDefault == null) return
    setLatch(dismissUpgradePrompt)
    const href: Href = `/story-settings/${storyId}?tab=memory`
    // The swap dialog lives in the Memory panel.
    if (navigate != null) navigate(href)
    else router.navigate(href)
    openEmbedderSwapDialog(storyId, appDefault)
  }, [storyId, appDefault, navigate, router, setLatch])

  const onKeep = useCallback(() => {
    if (storyId == null || appDefault == null) return
    setLatch(dismissUpgradePrompt)
    void declineUpgrade(storyId, appDefault)
      .then((result) => {
        if (result.status !== 'rejected') return
        // Nothing was written: treat it as Later, which the toast promises.
        embedderSwapStore.deferUpgrade(storyId)
        toast.error(t('storySettings:upgrade.keepFailed'))
      })
      .catch((error: unknown) => {
        const stale = error instanceof StorySettingsStaleStoreError
        const unreadable = error instanceof StorySettingsUnreadableError
        logger.error('embedder.decline_upgrade_failed', {
          storyId,
          stale,
          unreadable,
          error: error instanceof Error ? error.message : String(error),
        })
        // The decline is on disk either way, so deferring would promise a next-open
        // prompt that the recorded decline prevents.
        if (stale || unreadable) {
          toast.error(t(stale ? 'storySettings:save.stale' : 'storySettings:save.unreadable'))
          return
        }
        embedderSwapStore.deferUpgrade(storyId)
        toast.error(t('storySettings:upgrade.keepError'))
      })
  }, [storyId, appDefault, declineUpgrade, setLatch])

  const onLater = useCallback(() => {
    if (storyId == null) return
    setLatch(dismissUpgradePrompt)
    embedderSwapStore.deferUpgrade(storyId)
  }, [storyId, setLatch])

  if (storyId == null) return null

  return (
    <EmbeddingUpgradeDialog
      open={open}
      currentModelId={storyModelId ?? ''}
      targetModelId={appDefault ?? ''}
      onUpgrade={onUpgrade}
      onKeep={onKeep}
      onLater={onLater}
    />
  )
}

export type { EmbeddingUpgradeHostProps }
