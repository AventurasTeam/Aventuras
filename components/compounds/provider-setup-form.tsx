import { useState } from 'react'
import { View } from 'react-native'

import { ProviderModelPicker, type ModelRef } from '@/components/compounds/provider-model-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { addProvider, quickWireModel, updateProvider } from '@/lib/actions'
import { fetchModelCatalog } from '@/lib/ai'
import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { appSettingsStore } from '@/lib/stores'

const PROVIDER_ID = 'interim-oai-compat'

type CatalogState = 'idle' | 'fetching' | 'failed'

export function ProviderSetupForm() {
  const provider = appSettingsStore.useAppSettings((s) => s.providers[0])
  const defaultModel = appSettingsStore.useAppSettings(
    (s) => s.profiles.find((p) => p.kind === 'narrative')?.modelRef ?? null,
  )

  const [displayName, setDisplayName] = useState(provider?.displayName ?? '')
  const [endpoint, setEndpoint] = useState(provider?.endpoint ?? '')
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')
  const [catalog, setCatalog] = useState<CatalogState>('idle')
  const [picked, setPicked] = useState<ModelRef | null>(defaultModel)
  const [wired, setWired] = useState(false)

  // Picker walks cachedModels + customModelIds (data-model.md → App settings storage).
  const modelIds = [
    ...(provider?.cachedModels?.map((m) => m.id) ?? []),
    ...(provider?.customModelIds ?? []),
  ]

  const onSaveProvider = async () => {
    try {
      if (provider === undefined) {
        await addProvider(
          {
            id: PROVIDER_ID,
            type: 'openai-compatible',
            displayName,
            apiKey,
            endpoint,
            favoriteModelIds: [],
          },
          { db },
        )
      } else {
        await updateProvider(provider.id, { displayName, apiKey, endpoint }, { db })
      }
    } catch (e) {
      logger.error('provider.setup_save_failed', {
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const onFetchModels = async () => {
    if (provider === undefined) return
    setCatalog('fetching')
    try {
      const ids = await fetchModelCatalog({
        ...provider,
        displayName,
        endpoint,
        apiKey,
      })
      await updateProvider(
        provider.id,
        { cachedModels: ids.map((id) => ({ id })), cachedAt: Date.now() },
        { db },
      )
      setCatalog('idle')
    } catch (e) {
      logger.error('provider.setup_fetch_models_failed', {
        error: e instanceof Error ? e.message : String(e),
      })
      setCatalog('failed')
    }
  }

  const onQuickWire = async () => {
    if (picked === null) return
    setWired(false)
    try {
      await quickWireModel(picked, { db })
      setWired(true)
    } catch (e) {
      setWired(false)
      logger.error('provider.setup_quick_wire_failed', {
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <View className="gap-4">
      <Text variant="muted">{t('settings:providers.intro')}</Text>

      <View className="gap-1">
        <Text>{t('settings:providers.displayNameLabel')}</Text>
        <Input
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('settings:providers.displayNamePlaceholder')}
        />
      </View>
      <View className="gap-1">
        <Text>{t('settings:providers.endpointLabel')}</Text>
        <Input
          value={endpoint}
          onChangeText={setEndpoint}
          placeholder={t('settings:providers.endpointPlaceholder')}
          autoCapitalize="none"
        />
      </View>
      <View className="gap-1">
        <Text>{t('settings:providers.apiKeyLabel')}</Text>
        <Input
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={t('settings:providers.apiKeyPlaceholder')}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>

      <View className="flex-row gap-2">
        <Button onPress={() => void onSaveProvider()}>
          <Text>{t('settings:providers.save')}</Text>
        </Button>
        <Button
          variant="secondary"
          disabled={provider === undefined || catalog === 'fetching'}
          onPress={() => void onFetchModels()}
        >
          <Text>
            {catalog === 'fetching'
              ? t('settings:providers.fetching')
              : t('settings:providers.fetchModels')}
          </Text>
        </Button>
      </View>
      {catalog === 'failed' ? (
        <Text className="text-danger">{t('settings:providers.fetchFailed')}</Text>
      ) : null}

      <View className="gap-1">
        <Text>{t('settings:providers.modelLabel')}</Text>
        <ProviderModelPicker
          value={picked}
          onChange={(next) => {
            setPicked(next)
            setWired(false)
          }}
          placeholder={t('settings:providers.modelPlaceholder')}
          providers={
            provider !== undefined
              ? [
                  {
                    id: provider.id,
                    name: provider.displayName,
                    models: modelIds.map((id) => ({ id })),
                  },
                ]
              : []
          }
          favorites={[]}
          onFavoriteToggle={() => {}}
          onAddCustom={async (ref) => {
            if (provider !== undefined)
              try {
                await updateProvider(
                  provider.id,
                  { customModelIds: [...(provider.customModelIds ?? []), ref.modelId] },
                  { db },
                )
              } catch (e) {
                logger.error('provider.setup_add_custom_failed', {
                  error: e instanceof Error ? e.message : String(e),
                })
              }
          }}
        />
      </View>

      <Button disabled={picked === null} onPress={() => void onQuickWire()}>
        <Text>{t('settings:providers.quickWire')}</Text>
      </Button>
      {wired ? <Text className="text-success">{t('settings:providers.quickWired')}</Text> : null}
    </View>
  )
}
