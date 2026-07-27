import { useCallback, useEffect, useMemo } from 'react'
import { View } from 'react-native'

import { SwapDialog, type SwapCandidate } from '@/components/embedder/swap-dialog'
import { SwapResumeDialog } from '@/components/embedder/swap-resume-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useInstalledModels, type InstalledModelInfo } from '@/hooks/use-installed-models'
import {
  cancelStorySwap,
  refreshEmbeddingStatus,
  reindexStoryNow,
  relabelStory,
  RelabelBlockedError,
  resumeStorySwap,
  startStorySwap,
  SwapBusyError,
} from '@/lib/actions'
import { db, runInTransaction, type EmbeddingTarget, type StorySettings } from '@/lib/db'
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
    s.storyId === storyId ? s.staleTotal : 0,
  )
  const dialogOpen = embedderSwapStore.useSwap((s) => s.dialog?.storyId === storyId)
  const progress = embedderSwapStore.useSwap((s) =>
    s.progress?.storyId === storyId ? s.progress : null,
  )

  const { installed } = useInstalledModels(listInstalled)
  const appEmbeddingProviderId = appSettingsStore.useAppSettings((s) => s.embeddingProviderId)
  const appEmbeddingModelId = appSettingsStore.useAppSettings((s) => s.embeddingModelId)
  const providers = appSettingsStore.useAppSettings((s) => s.providers)

  useEffect(() => {
    void refreshEmbeddingStatus(storyId)
  }, [storyId])

  const candidates = useMemo<SwapCandidate[]>(() => {
    const local: SwapCandidate[] = (installed ?? []).map((model) => ({
      id: model.id,
      label: getCatalogEntry(model.id)?.displayName ?? model.id,
      isCurrent: model.id === settings.embedding_model_id,
      backend: 'local',
    }))
    const provider = providers.find((p) => p.id === appEmbeddingProviderId)
    const providerUsable =
      provider != null &&
      appEmbeddingModelId != null &&
      appEmbeddingModelId.trim() !== '' &&
      providerTypeSupportsEmbedding(provider.type) &&
      providerHasEmbeddingEndpoint(provider)
    if (!providerUsable) return local
    const all: SwapCandidate[] = [
      ...local,
      {
        id: appEmbeddingModelId,
        label: appEmbeddingModelId,
        isCurrent: appEmbeddingModelId === settings.embedding_model_id,
        backend: 'provider',
        providerId: appEmbeddingProviderId,
      },
    ]
    // A provider model id and an installed local model id are both free-form
    // strings and can be equal, which would render two rows under one React
    // key. Local wins the collision — it carries the catalog display label.
    const byId = new Map<string, SwapCandidate>()
    for (const candidate of all) if (!byId.has(candidate.id)) byId.set(candidate.id, candidate)
    return [...byId.values()]
  }, [
    installed,
    providers,
    appEmbeddingProviderId,
    appEmbeddingModelId,
    settings.embedding_model_id,
  ])

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

  const handleReindexNow = useCallback(async () => {
    try {
      await reindexStoryNow(storyId, ctx)
    } catch (error) {
      reportEngineFailure('reindex_now', error)
    } finally {
      void refreshEmbeddingStatus(storyId)
    }
  }, [storyId, reportEngineFailure])

  const handleCancelProgress = useCallback(() => {
    embedderSwapStore.requestCancel()
  }, [])

  // The dialog reports the picked id; the candidate list is what knows which
  // backend serves it, and ids are unique there (see the dedupe above).
  const targetFor = useCallback(
    (targetId: string): EmbeddingTarget => {
      const candidate = candidates.find((c) => c.id === targetId)
      return {
        modelId: targetId,
        backend: candidate?.backend ?? settings.embeddingBackend,
        providerId: candidate?.providerId,
      }
    },
    [candidates, settings.embeddingBackend],
  )

  const handleReindexTarget = useCallback(
    async (targetId: string) => {
      embedderSwapStore.closeDialog()
      try {
        await startStorySwap(storyId, targetFor(targetId), ctx)
      } catch (error) {
        reportEngineFailure('swap_start', error)
      } finally {
        void refreshEmbeddingStatus(storyId)
      }
    },
    [storyId, reportEngineFailure, targetFor],
  )

  const handleKeep = useCallback(() => {
    // Nag-suppression persistence is the deferred upgrade-prompt surface (post-v1);
    // nothing to persist here — dismissing the dialog is the whole action.
    embedderSwapStore.closeDialog()
  }, [])

  const handleRelabel = useCallback(
    async (targetId: string) => {
      embedderSwapStore.closeDialog()
      try {
        await relabelStory(storyId, targetFor(targetId), ctx)
      } catch (error) {
        if (error instanceof RelabelBlockedError)
          toast.info(t('storySettings:memory.relabelBlocked'))
        else reportEngineFailure('relabel', error)
      } finally {
        void refreshEmbeddingStatus(storyId)
      }
    },
    [storyId, reportEngineFailure, targetFor],
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
      await cancelStorySwap(storyId, ctx)
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

      <View className="gap-1">
        <Button
          testID="reindex-now"
          variant="secondary"
          disabled={settings.embedding_swap_target != null || progress != null}
          onPress={() => void handleReindexNow()}
        >
          <Text>{t('storySettings:memory.reindexNow')}</Text>
        </Button>
        <Text size="xs" variant="muted" className="px-1">
          {t('storySettings:memory.reindexNowHint')}
        </Text>
      </View>

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
        onReindex={(targetId) => void handleReindexTarget(targetId)}
        onKeep={handleKeep}
        onRelabel={(targetId) => void handleRelabel(targetId)}
        onDismiss={handleDismissDialog}
      />

      <SwapResumeDialog
        open={resumeOpen}
        targetModelName={settings.embedding_swap_target ?? ''}
        onResume={() => void handleResume()}
        onCancelSwap={() => void handleCancelSwap()}
      />
    </View>
  )
}

export type { MemoryPanelProps }
