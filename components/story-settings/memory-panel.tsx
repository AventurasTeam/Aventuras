import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import { ReindexConfirmDialog } from '@/components/embedder/reindex-confirm-dialog'
import { SwapDialog, type SwapCandidate } from '@/components/embedder/swap-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useInstalledModels, type InstalledModelInfo } from '@/hooks/use-installed-models'
import {
  cancelStorySwap,
  countStoryEmbeddableRows,
  refreshEmbeddingStatus,
  reindexStoryNow,
  relabelStory,
  RelabelBlockedError,
  RelabelDimMismatchError,
  resumeStorySwap,
  startStorySwap,
  SwapBusyError,
} from '@/lib/actions'
import {
  db,
  runInTransaction,
  sameEmbeddingTarget,
  type EmbeddingTarget,
  type StorySettings,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  getCatalogEntry,
  providerHasEmbeddingEndpoint,
  providerTypeSupportsEmbedding,
  resolveEmbedderConfig,
} from '@/lib/embedder'
import { t } from '@/lib/i18n'
import {
  appSettingsStore,
  embedderSwapStore,
  embeddingStatusStore,
  openEmbedderSwapDialog,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Unresolvable-config reasons the memory tab can explain (see resolveEmbedderConfig);
// 'no-model' and 'unknown-local-model' both read as "the model is gone" to the user.
const REASON_KEY = {
  'no-model': 'modelMissing',
  'no-provider': 'providerUnconfigured',
  'unknown-local-model': 'modelMissing',
} as const

type MemoryPanelProps = {
  storyId: string
  settings: StorySettings
  /** Injectable seam for stories/tests — defaults to lib/embedder's listInstalledLocal. */
  listInstalled?: () => Promise<InstalledModelInfo[]>
}

/**
 * Story-scoped memory resolution surface (model-management.md → Staleness
 * UI). Swap / re-index / relabel commit straight through the embedder engine,
 * not the save bar — this panel intentionally doesn't join
 * `useStorySettingsSection`.
 */
export function MemoryPanel({ storyId, settings, listInstalled }: MemoryPanelProps) {
  const staleTotal = embeddingStatusStore.useEmbeddingStatus((s) =>
    embeddingStatusStore.staleTotalFor(s, storyId),
  )
  const [reindexConfirmOpen, setReindexConfirmOpen] = useState(false)
  const [reindexRowCount, setReindexRowCount] = useState<number | null>(null)
  const dialogOpen = embedderSwapStore.useSwap((s) => s.dialog?.storyId === storyId)
  const progress = embedderSwapStore.useSwap((s) => embedderSwapStore.progressFor(s, storyId))

  const { installed } = useInstalledModels(listInstalled)
  const appEmbeddingProviderId = appSettingsStore.useAppSettings((s) => s.embeddingProviderId)
  const appEmbeddingModelId = appSettingsStore.useAppSettings((s) => s.embeddingModelId)
  const providers = appSettingsStore.useAppSettings((s) => s.providers)

  useEffect(() => {
    void refreshEmbeddingStatus(storyId)
  }, [storyId])

  const storyTarget = useMemo<EmbeddingTarget>(
    () => ({
      modelId: settings.embedding_model_id,
      backend: settings.embeddingBackend,
      providerId: settings.embedding_provider_id,
    }),
    [settings.embedding_model_id, settings.embeddingBackend, settings.embedding_provider_id],
  )

  const candidates = useMemo<SwapCandidate[]>(() => {
    const candidate = (target: EmbeddingTarget, label: string, sourceLabel: string) => ({
      target,
      label,
      sourceLabel,
      // The whole target, not the model id: a story on a provider's copy of a
      // model must still be offered the local copy, which is a different
      // embedder that happens to share a name.
      isCurrent: sameEmbeddingTarget(target, storyTarget),
    })

    const local = (installed ?? []).map((model) =>
      candidate(
        { modelId: model.id, backend: 'local' },
        getCatalogEntry(model.id)?.displayName ?? model.id,
        t('storySettings:swap.sourceLocal'),
      ),
    )
    const provider = providers.find((p) => p.id === appEmbeddingProviderId)
    const providerUsable =
      provider != null &&
      appEmbeddingModelId != null &&
      appEmbeddingModelId.trim() !== '' &&
      providerTypeSupportsEmbedding(provider.type) &&
      providerHasEmbeddingEndpoint(provider)
    if (!providerUsable) return local

    // Deliberately NOT de-duplicated by model id: a model installed locally and
    // also served by the provider is two embedders the user can choose between.
    return [
      ...local,
      candidate(
        { modelId: appEmbeddingModelId, backend: 'provider', providerId: appEmbeddingProviderId },
        appEmbeddingModelId,
        provider.displayName,
      ),
    ]
  }, [installed, providers, appEmbeddingProviderId, appEmbeddingModelId, storyTarget])

  const reasonLine = useMemo(() => {
    // resolveEmbedderConfig reads `settings` (the panel's own prop) directly rather
    // than storiesStore, so this reflects exactly what the panel is showing — no
    // dependency on a second, possibly-unsynced global read.
    const resolution = resolveEmbedderConfig(settings, {
      embeddingModelId: appEmbeddingModelId,
      embeddingProviderId: appEmbeddingProviderId,
      defaultStorySettings: {},
    })
    if (!resolution.ok) return t(`storySettings:memory.reason.${REASON_KEY[resolution.reason]}`)
    return staleTotal > 0 ? t('storySettings:memory.reason.retrying') : null
  }, [settings, appEmbeddingModelId, appEmbeddingProviderId, staleTotal])

  const reportEngineFailure = useCallback(
    (op: string, error: unknown) => {
      if (error instanceof SwapBusyError) {
        toast.info(t('storySettings:memory.busy'))
        return
      }
      logger.error(`embedder.${op}_failed`, { storyId, error: messageOf(error) })
      toast.error(t('storySettings:memory.actionFailed'))
    },
    [storyId],
  )

  const openReindexConfirm = useCallback(() => {
    setReindexRowCount(null)
    setReindexConfirmOpen(true)
    // Fetched on open rather than on mount: the panel renders on every Memory
    // tab visit, and the count only matters once the user reaches for the button.
    void countStoryEmbeddableRows(storyId, ctx).then(setReindexRowCount)
  }, [storyId])

  const handleReindexNow = useCallback(async () => {
    setReindexConfirmOpen(false)
    try {
      await reindexStoryNow(storyId, ctx)
    } catch (error) {
      reportEngineFailure('reindex_now', error)
    } finally {
      void refreshEmbeddingStatus(storyId)
    }
  }, [storyId, reportEngineFailure])

  const handleCancelProgress = useCallback(() => {
    embedderSwapStore.requestCancel(storyId)
  }, [storyId])

  const handleReindexTarget = useCallback(
    async (target: EmbeddingTarget) => {
      embedderSwapStore.closeDialog()
      try {
        await startStorySwap(storyId, target, ctx)
      } catch (error) {
        reportEngineFailure('swap_start', error)
      } finally {
        void refreshEmbeddingStatus(storyId)
      }
    },
    [storyId, reportEngineFailure],
  )

  const handleKeep = useCallback(() => {
    // Nag-suppression persistence is the deferred upgrade-prompt surface (post-v1);
    // nothing to persist here — dismissing the dialog is the whole action.
    embedderSwapStore.closeDialog()
  }, [])

  const handleRelabel = useCallback(
    async (target: EmbeddingTarget) => {
      embedderSwapStore.closeDialog()
      try {
        await relabelStory(storyId, target, ctx)
      } catch (error) {
        if (error instanceof RelabelBlockedError)
          toast.info(t('storySettings:memory.relabelBlocked'))
        else if (error instanceof RelabelDimMismatchError)
          toast.error(t('storySettings:memory.relabelDimMismatch'))
        else reportEngineFailure('relabel', error)
      } finally {
        void refreshEmbeddingStatus(storyId)
      }
    },
    [storyId, reportEngineFailure],
  )

  const handleDismissDialog = useCallback(() => {
    embedderSwapStore.closeDialog()
  }, [])

  const resumeOpen = settings.embedding_swap_target != null && progress == null

  const handleResume = useCallback(async () => {
    try {
      await resumeStorySwap(storyId, ctx)
    } catch (error) {
      reportEngineFailure('resume', error)
    } finally {
      void refreshEmbeddingStatus(storyId)
    }
  }, [storyId, reportEngineFailure])

  const handleCancelSwap = useCallback(async () => {
    try {
      // A swap can finish between the click and the loop's last cancel poll, in
      // which case the model changed — saying nothing would let the user believe
      // they stopped it.
      if ((await cancelStorySwap(storyId, ctx)) === 'already-completed') {
        toast.info(t('storySettings:memory.cancelTooLate'))
      }
    } catch (error) {
      reportEngineFailure('cancel_swap', error)
    } finally {
      void refreshEmbeddingStatus(storyId)
    }
  }, [storyId, reportEngineFailure])

  return (
    <View testID="memory-panel" className="gap-4">
      <Text className="font-semibold">{t('storySettings:memory.heading')}</Text>
      <Text>{t('storySettings:memory.staleCount', { count: staleTotal })}</Text>
      {reasonLine != null ? (
        <Text size="sm" variant="muted">
          {reasonLine}
        </Text>
      ) : null}
      <Text size="sm" variant="muted">
        {t('storySettings:memory.currentModel', { model: settings.embedding_model_id })}
      </Text>

      <View className="gap-1">
        <Button
          disabled={settings.embedding_swap_target != null || progress != null}
          onPress={() => openEmbedderSwapDialog(storyId)}
        >
          <Text>{t('storySettings:memory.switchEmbedder')}</Text>
        </Button>
        {settings.embedding_swap_target != null ? (
          <Text size="xs" variant="muted">
            {t('storySettings:memory.swapPending')}
          </Text>
        ) : null}
      </View>

      <Button
        testID="reindex-now"
        variant="secondary"
        disabled={settings.embedding_swap_target != null || progress != null}
        onPress={openReindexConfirm}
      >
        <Text>{t('storySettings:memory.reindexNow')}</Text>
      </Button>

      <ReindexConfirmDialog
        open={reindexConfirmOpen}
        onOpenChange={setReindexConfirmOpen}
        rowCount={reindexRowCount}
        modelLabel={settings.embedding_model_id}
        onConfirm={() => void handleReindexNow()}
      />

      {progress != null ? (
        <View className="flex-row items-center gap-3">
          <Text size="sm">
            {t('storySettings:memory.reindexing', { done: progress.done, total: progress.total })}
          </Text>
          <Button
            testID="memory-cancel-swap"
            variant="secondary"
            size="sm"
            onPress={handleCancelProgress}
          >
            <Text>{t('storySettings:memory.cancel')}</Text>
          </Button>
        </View>
      ) : null}

      <SwapDialog
        open={dialogOpen}
        candidates={candidates}
        onReindex={(target) => void handleReindexTarget(target)}
        onKeep={handleKeep}
        onRelabel={(target) => void handleRelabel(target)}
        onDismiss={handleDismissDialog}
      />

      {resumeOpen ? (
        // Inline, not a modal: the app-level SwapResumeHost owns the prompt. This
        // row is also the only affordance when Story Settings is reached by a cold
        // reload, where there is no open story for the host to key on.
        <View testID="memory-swap-pending" className="gap-2 rounded-md border border-border p-3">
          <Text className="font-semibold">{t('storySettings:memory.swapPendingTitle')}</Text>
          <Text size="sm" variant="muted">
            {t('storySettings:memory.swapPendingBody', {
              model: settings.embedding_swap_target ?? '',
            })}
          </Text>
          <View className="flex-row gap-2">
            <Button
              testID="memory-swap-pending-resume"
              variant="primary"
              onPress={() => void handleResume()}
            >
              <Text>{t('storySettings:swap.resume')}</Text>
            </Button>
            <Button
              testID="memory-swap-pending-cancel"
              variant="destructive"
              onPress={() => void handleCancelSwap()}
            >
              <Text>{t('storySettings:swap.cancelSwap')}</Text>
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export type { MemoryPanelProps }
