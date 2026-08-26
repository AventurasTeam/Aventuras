import { Check } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { View } from 'react-native'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useInstalledModels, type InstalledModelInfo } from '@/hooks/use-installed-models'
import { setEmbedderDefaults } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  EMBEDDER_CATALOG,
  createEmbedderDownloadDriver,
  sanitizeModelDirName,
  testEmbedder,
  toDialogCatalogEntry,
  type CatalogModelEntry,
} from '@/lib/embedder'
import { t } from '@/lib/i18n'
import { appSettingsStore } from '@/lib/stores'

import { EmbedderDownloadDialog } from './embedder-download-dialog'
import type { DialogDriver, DialogInit, DialogResolution } from './embedder-download-dialog-machine'

type LocalTestResult =
  | { ok: true; dim: number; ms: number }
  | { ok: false; kind: 'init' | 'call'; message: string }

type RunTestFn = (config: {
  backend: 'local'
  modelId: string
  dim: number
}) => Promise<LocalTestResult>

type CreateDriverFn = (entry: CatalogModelEntry) => DialogDriver

function formatModelSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  return `${Math.round(bytes / 1_000_000)} MB`
}

type EmbeddingModelsPanelProps = {
  /** Injectable seam for stories/tests — defaults to lib/embedder's listInstalledLocal. */
  listInstalled?: () => Promise<InstalledModelInfo[]>
  /** Injectable seam for stories/tests — defaults to lib/embedder's testEmbedder. */
  runTest?: RunTestFn
  /** Injectable seam for stories/tests — defaults to lib/embedder's createEmbedderDownloadDriver. */
  createDriver?: CreateDriverFn
}

export function EmbeddingModelsPanel({
  listInstalled,
  runTest = testEmbedder,
  createDriver = createEmbedderDownloadDriver,
}: EmbeddingModelsPanelProps) {
  const { installed, state: installedState, refresh } = useInstalledModels(listInstalled)
  const backend = appSettingsStore.useAppSettings(
    (s) => s.defaultStorySettings.embeddingBackend ?? 'local',
  )
  const embeddingModelId = appSettingsStore.useAppSettings((s) => s.embeddingModelId)

  const installedById = useMemo(() => {
    const map = new Map<string, InstalledModelInfo>()
    for (const row of installed ?? []) map.set(row.id, row)
    return map
  }, [installed])

  const setDefault = useCallback((modelId: string) => {
    void setEmbedderDefaults(
      { backend: 'local', modelId, providerId: null },
      { db, runInTransaction },
    ).catch((e: unknown) => {
      logger.error('embedder.default_save_failed', {
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }, [])

  const onInstalled = useCallback(
    (modelId: string) => {
      refresh()
      // Adopt only into an empty local slot. `embeddingModelId` doubles as the
      // provider arm's model *name*, so adopting under a provider backend would
      // write a catalog id into the field sent to the provider API — turning an
      // honest 'no-model' block into a gate that passes and fails at embed time.
      if (backend === 'local' && embeddingModelId === null) setDefault(modelId)
    },
    [refresh, backend, embeddingModelId, setDefault],
  )

  return (
    <View className="gap-4">
      <Text variant="muted">{t('settings:embedding.intro')}</Text>
      {installedState.status === 'error' ? (
        <View className="gap-2 rounded-md border border-danger bg-bg-raised p-3">
          <Text size="sm" className="text-danger">
            {t('settings:embedding.listFailed', { error: installedState.message })}
          </Text>
          <View className="flex-row">
            <Button variant="secondary" size="sm" onPress={refresh}>
              <Text>{t('settings:embedding.listRetry')}</Text>
            </Button>
          </View>
        </View>
      ) : null}
      <Accordion type="multiple">
        {EMBEDDER_CATALOG.models.map((entry) => (
          <AccordionItem
            key={entry.id}
            value={entry.id}
            className="mb-3 rounded-md border border-border bg-bg-raised px-4"
          >
            <CatalogEntryRow
              entry={entry}
              installedInfo={installedById.get(entry.id)}
              runTest={runTest}
              createDriver={createDriver}
              onInstalled={onInstalled}
              isDefault={backend === 'local' && embeddingModelId === entry.id}
              onSetDefault={setDefault}
            />
          </AccordionItem>
        ))}
      </Accordion>
    </View>
  )
}

function CatalogEntryRow({
  entry,
  installedInfo,
  runTest,
  createDriver,
  onInstalled,
  isDefault,
  onSetDefault,
}: {
  entry: CatalogModelEntry
  installedInfo: InstalledModelInfo | undefined
  runTest: RunTestFn
  createDriver: CreateDriverFn
  onInstalled: (modelId: string) => void
  isDefault: boolean
  onSetDefault: (modelId: string) => void
}) {
  const isInstalled = installedInfo != null
  const [dialogOpen, setDialogOpen] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'running' | LocalTestResult>('idle')

  // Stable across re-renders for the lifetime of the (static) catalog entry —
  // the dialog's open item warns a re-allocated `init` cancels an in-flight
  // download, so these are only ever recomputed if `entry` itself changes.
  const dialogInit = useMemo<DialogInit>(
    () => ({ kind: 'catalog', entry: toDialogCatalogEntry(entry) }),
    [entry],
  )
  const driver = useMemo(() => createDriver(entry), [createDriver, entry])

  const onResolve = useCallback(
    (result: DialogResolution) => {
      setDialogOpen(false)
      if (result.kind === 'installed') onInstalled(entry.id)
    },
    [onInstalled, entry.id],
  )

  const onTest = useCallback(async () => {
    setTestState('running')
    const result = await runTest({ backend: 'local', modelId: entry.id, dim: entry.dim })
    setTestState(result)
  }, [runTest, entry.id, entry.dim])

  return (
    <>
      {/* Get/Installed sits as a sibling of AccordionTrigger, not nested
          inside it — the trigger renders a native <button> on web, and a
          Button nested inside it produces invalid <button>-in-<button>
          markup (and a native double-touchable). */}
      <View className="flex-row items-center gap-3">
        {/* The trigger's flex participant in this row is the primitive's Header
            (the Pressable receiving className sits inside it), so flex-1 on the
            trigger itself never reaches the row — Yoga then collapses the
            content to zero width. A plain flex-1 View owns the row growth. */}
        <View className="min-w-0 flex-1">
          <AccordionTrigger>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-semibold">{entry.displayName}</Text>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Text size="xs" variant="muted">
                  {t('settings:embedding.sizeDim', {
                    size: formatModelSize(entry.size_bytes),
                    dim: entry.dim,
                  })}
                </Text>
                {entry.tags.map((tag) => (
                  <Tag key={tag} tone="soft">
                    {tag}
                  </Tag>
                ))}
              </View>
            </View>
          </AccordionTrigger>
        </View>
        {isInstalled ? (
          <Tag tone="success" leading={<Icon as={Check} size="sm" />}>
            {t('settings:embedding.installed')}
          </Tag>
        ) : (
          <Button
            size="sm"
            accessibilityLabel={t('settings:embedding.getA11y', { model: entry.displayName })}
            onPress={() => setDialogOpen(true)}
          >
            <Text>{t('settings:embedding.get')}</Text>
          </Button>
        )}
      </View>
      <AccordionContent className="gap-3">
        <Text size="sm" variant="muted">
          {entry.shortDescription}
        </Text>
        {isInstalled ? (
          <View className="gap-2">
            <Text size="sm" variant="muted">
              {t('settings:embedding.folder', { folder: sanitizeModelDirName(entry.id) })}
            </Text>
            <View className="flex-row flex-wrap items-center gap-3">
              {isDefault ? (
                <Tag tone="soft">{t('settings:embedding.isDefault')}</Tag>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  accessibilityLabel={t('settings:embedding.setDefaultA11y', {
                    model: entry.displayName,
                  })}
                  onPress={() => onSetDefault(entry.id)}
                >
                  <Text>{t('settings:embedding.setDefault')}</Text>
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={testState === 'running'}
                accessibilityLabel={t('settings:embedding.testA11y', { model: entry.displayName })}
                onPress={() => void onTest()}
              >
                <Text>
                  {testState === 'running'
                    ? t('settings:embedding.testing')
                    : t('settings:embedding.testButton')}
                </Text>
              </Button>
              {testState !== 'idle' && testState !== 'running' ? (
                testState.ok ? (
                  <Text size="sm" className="text-success">
                    {t('settings:embedding.testOk', { dim: testState.dim, ms: testState.ms })}
                  </Text>
                ) : (
                  <View className="gap-1">
                    <Text size="sm" className="text-danger">
                      {t(`settings:embedding.testFailed.${testState.kind}` as const)}
                    </Text>
                    <Text size="xs" variant="muted">
                      {t('embedder:failure.technicalDetail')}
                    </Text>
                    <Text size="xs" className="font-mono">
                      {testState.message}
                    </Text>
                  </View>
                )
              ) : null}
            </View>
          </View>
        ) : null}
      </AccordionContent>
      {dialogOpen ? (
        <EmbedderDownloadDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          init={dialogInit}
          driver={driver}
          onResolve={onResolve}
        />
      ) : null}
    </>
  )
}

export type { EmbeddingModelsPanelProps }
