import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useInstalledModels, type InstalledModelInfo } from '@/hooks/use-installed-models'
import { setEmbedderDefaults } from '@/lib/actions'
import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { getCatalogEntry, testEmbedder, type EmbedderConfig } from '@/lib/embedder'
import { t } from '@/lib/i18n'
import { appSettingsStore } from '@/lib/stores'

type TestResult =
  | { ok: true; dim: number; ms: number }
  | { ok: false; kind: 'init' | 'call'; message: string }

type RunTestFn = (
  config: EmbedderConfig,
  provider?: Parameters<typeof testEmbedder>[1],
) => Promise<TestResult>

type EmbedderDefaultCardProps = {
  /** Switches App Settings to the Embedding models tab (host-owned nav). */
  onManage?: () => void
  /** Injectable seam for stories/tests — defaults to lib/embedder's listInstalledLocal. */
  listInstalled?: () => Promise<InstalledModelInfo[]>
  /** Injectable seam for stories/tests — defaults to lib/embedder's testEmbedder. */
  runTest?: RunTestFn
}

function TestRow({
  disabled,
  onPress,
  testState,
}: {
  disabled: boolean
  onPress: () => void
  testState: 'idle' | 'running' | TestResult
}) {
  return (
    <View className="flex-row flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" disabled={disabled} onPress={onPress}>
        <Text>
          {testState === 'running'
            ? t('settings:embedderDefault.testing')
            : t('settings:embedderDefault.testButton')}
        </Text>
      </Button>
      {testState !== 'idle' && testState !== 'running' ? (
        testState.ok ? (
          <Text size="sm" className="text-success">
            {t('settings:embedderDefault.testOk', { dim: testState.dim, ms: testState.ms })}
          </Text>
        ) : (
          <View className="gap-1">
            <Text size="sm" className="text-danger">
              {t(`settings:embedderDefault.testFailed.${testState.kind}` as const)}
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
  )
}

export function EmbedderDefaultCard({
  onManage,
  listInstalled,
  runTest = testEmbedder,
}: EmbedderDefaultCardProps) {
  const backend = appSettingsStore.useAppSettings(
    (s) => s.defaultStorySettings.embeddingBackend ?? 'local',
  )
  const embeddingModelId = appSettingsStore.useAppSettings((s) => s.embeddingModelId)
  const embeddingProviderId = appSettingsStore.useAppSettings((s) => s.embeddingProviderId)
  const providers = appSettingsStore.useAppSettings((s) => s.providers)

  const { installed, state: installedState } = useInstalledModels(listInstalled)

  const [providerIdDraft, setProviderIdDraft] = useState(embeddingProviderId ?? '')
  const [modelIdDraft, setModelIdDraft] = useState(embeddingModelId ?? '')
  // Local drafts only track the store on backend switch — once the user is
  // editing, the input (not the store) is the visible source of truth until
  // the next persisted write round-trips back through the selectors above.
  useEffect(() => {
    setProviderIdDraft(embeddingProviderId ?? '')
    setModelIdDraft(embeddingModelId ?? '')
  }, [backend, embeddingProviderId, embeddingModelId])

  const [testState, setTestState] = useState<'idle' | 'running' | TestResult>('idle')
  useEffect(() => setTestState('idle'), [backend, embeddingModelId, embeddingProviderId])

  const localOptions = useMemo<SelectOption[]>(
    () =>
      (installed ?? []).flatMap((row) => {
        const entry = getCatalogEntry(row.id)
        return entry ? [{ value: row.id, label: entry.displayName }] : []
      }),
    [installed],
  )

  const providerOptions = useMemo<SelectOption[]>(
    () => providers.map((p) => ({ value: p.id, label: p.displayName })),
    [providers],
  )

  const selectedProvider = providers.find((p) => p.id === providerIdDraft)
  const providerModelOptions = useMemo<SelectOption[]>(
    () =>
      (selectedProvider?.cachedModels ?? [])
        .filter((m) => m.capabilities?.embedding === true)
        .map((m) => ({ value: m.id, label: m.id })),
    [selectedProvider],
  )

  const persistLocal = useCallback((modelId: string) => {
    void setEmbedderDefaults(
      { backend: 'local', modelId: modelId === '' ? null : modelId, providerId: null },
      { db },
    ).catch((e: unknown) => {
      logger.error('embedder.default_save_failed', {
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }, [])

  const persistProvider = useCallback((providerId: string, modelId: string) => {
    void setEmbedderDefaults(
      {
        backend: 'provider',
        modelId: modelId.trim() === '' ? null : modelId.trim(),
        providerId: providerId === '' ? null : providerId,
      },
      { db },
    ).catch((e: unknown) => {
      logger.error('embedder.default_save_failed', {
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }, [])

  const onBackendChange = (next: string) => {
    if (next !== 'local' && next !== 'provider') return
    if (next === 'local') {
      persistLocal(localOptions[0]?.value ?? '')
    } else {
      const firstProviderId = providerOptions[0]?.value ?? ''
      setProviderIdDraft(firstProviderId)
      setModelIdDraft('')
      persistProvider(firstProviderId, '')
    }
  }

  const onProviderChange = (nextProviderId: string) => {
    setProviderIdDraft(nextProviderId)
    persistProvider(nextProviderId, modelIdDraft)
  }

  const onProviderModelPick = (nextModelId: string) => {
    setModelIdDraft(nextModelId)
    persistProvider(providerIdDraft, nextModelId)
  }

  const onModelIdBlur = () => {
    persistProvider(providerIdDraft, modelIdDraft)
  }

  const onTest = useCallback(async () => {
    setTestState('running')
    if (backend === 'local') {
      const entry = embeddingModelId ? getCatalogEntry(embeddingModelId) : undefined
      const result = await runTest({
        backend: 'local',
        modelId: embeddingModelId ?? '',
        dim: entry?.dim ?? 0,
      })
      setTestState(result)
      return
    }
    const provider = providers.find((p) => p.id === providerIdDraft)
    const result = await runTest(
      // null, not 0: a probe is exactly the call that discovers the dim, and 0
      // sits in the same numeric slot as a real one, so the service's
      // dim-mismatch guard would reject every response.
      { backend: 'provider', providerId: providerIdDraft, modelId: modelIdDraft, dim: null },
      provider,
    )
    setTestState(result)
  }, [backend, embeddingModelId, runTest, providers, providerIdDraft, modelIdDraft])

  const backendOptions: SelectOption[] = [
    { value: 'local', label: t('settings:embedderDefault.backendLocal') },
    { value: 'provider', label: t('settings:embedderDefault.backendProvider') },
  ]

  return (
    <View className="gap-4">
      <Text className="font-semibold">{t('settings:embedderDefault.heading')}</Text>
      <Text variant="muted" size="sm">
        {t('settings:embedderDefault.intro')}
      </Text>

      <View className="gap-2">
        <Text size="sm" variant="muted">
          {t('settings:embedderDefault.backendLabel')}
        </Text>
        <Select
          options={backendOptions}
          value={backend}
          onValueChange={onBackendChange}
          mode="segment"
          label={t('settings:embedderDefault.backendLabel')}
        />
      </View>

      {backend === 'local' ? (
        <View className="gap-2">
          <View className="flex-row items-center justify-between gap-2">
            <Text size="sm" variant="muted">
              {t('settings:embedderDefault.localModelLabel')}
            </Text>
            {onManage ? (
              <Button variant="ghost" size="sm" onPress={onManage}>
                <Text>{t('settings:embedderDefault.manageLink')}</Text>
              </Button>
            ) : null}
          </View>
          {localOptions.length > 0 ? (
            <Select
              options={localOptions}
              value={embeddingModelId ?? ''}
              onValueChange={persistLocal}
              label={t('settings:embedderDefault.localModelLabel')}
            />
          ) : installedState.status === 'error' ? (
            <Text size="sm" className="text-danger">
              {t('settings:embedderDefault.localListFailed')}
            </Text>
          ) : installedState.status === 'loading' ? (
            <Text size="sm" variant="muted">
              {t('settings:embedderDefault.localLoading')}
            </Text>
          ) : (
            <Text size="sm" variant="muted">
              {t('settings:embedderDefault.localEmptyState')}
            </Text>
          )}
          <TestRow
            disabled={testState === 'running' || !embeddingModelId}
            onPress={() => void onTest()}
            testState={testState}
          />
        </View>
      ) : (
        <View className="gap-3">
          <View className="gap-2">
            <Text size="sm" variant="muted">
              {t('settings:embedderDefault.providerLabel')}
            </Text>
            {providerOptions.length > 0 ? (
              <Select
                options={providerOptions}
                value={providerIdDraft}
                onValueChange={onProviderChange}
                label={t('settings:embedderDefault.providerLabel')}
              />
            ) : (
              <Text size="sm" variant="muted">
                {t('settings:embedderDefault.providerEmptyState')}
              </Text>
            )}
          </View>

          {providerModelOptions.length > 0 ? (
            <View className="gap-2">
              <Text size="sm" variant="muted">
                {t('settings:embedderDefault.modelSelectLabel')}
              </Text>
              <Select
                options={providerModelOptions}
                value={modelIdDraft}
                onValueChange={onProviderModelPick}
                placeholder={t('settings:embedderDefault.modelSelectPlaceholder')}
                label={t('settings:embedderDefault.modelSelectLabel')}
              />
            </View>
          ) : null}

          <View className="gap-1">
            <Text size="sm" variant="muted">
              {t('settings:embedderDefault.modelIdLabel')}
            </Text>
            <Input
              value={modelIdDraft}
              onChangeText={setModelIdDraft}
              onBlur={onModelIdBlur}
              onSubmitEditing={onModelIdBlur}
              placeholder={t('settings:embedderDefault.modelIdPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text size="xs" variant="muted">
              {t('settings:embedderDefault.providerHint')}
            </Text>
          </View>

          <TestRow
            disabled={testState === 'running' || !providerIdDraft || !modelIdDraft}
            onPress={() => void onTest()}
            testState={testState}
          />
        </View>
      )}
    </View>
  )
}

export type { EmbedderDefaultCardProps }
