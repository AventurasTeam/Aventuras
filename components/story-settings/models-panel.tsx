import { X } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { ProviderModelPicker, type ModelRef } from '@/components/compounds/provider-model-picker'
import { Heading } from '@/components/ui/heading'
import { IconAction } from '@/components/ui/icon-action'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { updateProvider } from '@/lib/actions'
import { STORY_OVERRIDE_TARGETS, type ResolveModelConfig, type StoryOverrideTarget } from '@/lib/ai'
import { db, runInTransaction, type StoryAgentId, type StorySettings } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { appSettingsStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

import {
  appendedCustomModelIds,
  availableAgents,
  describeChain,
  modelsDirtyTargets,
  overrideProviderMissing,
  providerFavorites,
  providerListsModel,
  providerSources,
  toggledFavoriteIds,
  type ChainDescription,
} from './models-panel-state'
import { useStorySettingsSection } from './save-session'

const ctx = { db, runInTransaction }

type StoryModels = StorySettings['models']

type ModelsPanelProps = {
  settings: StorySettings
  disabled?: boolean
  disabledReason?: string
}

function targetLabel(target: StoryOverrideTarget): string {
  return target === 'narrative'
    ? t('storySettings:models.narrative')
    : t(`storySettings:models.agent.${target}`)
}

function chainText(chain: ChainDescription): string {
  if (chain.kind === 'broken') return t(`storySettings:models.broken.${chain.failure}`)
  return chain.profileName == null
    ? t('storySettings:models.appDefaultNoProfile', { model: chain.modelId })
    : t('storySettings:models.appDefault', { model: chain.modelId, profile: chain.profileName })
}

function reportProviderWriteFailure(
  kind: 'action_layer.provider_favorite_failed' | 'action_layer.provider_add_custom_failed',
  providerId: string,
  error: unknown,
): void {
  logger.error(kind, {
    providerId,
    error: error instanceof Error ? error.message : String(error),
  })
  toast.error(t('storySettings:models.providerWriteFailed'))
}

/** story-settings.md → Models tab: overrides only, the chain beneath them as a sentinel. */
export function ModelsPanel({ settings, disabled = false, disabledReason }: ModelsPanelProps) {
  const providers = appSettingsStore.useAppSettings((s) => s.providers)
  const profiles = appSettingsStore.useAppSettings((s) => s.profiles)
  const assignments = appSettingsStore.useAppSettings((s) => s.assignments)

  const [draft, setDraft] = useState<StoryModels>(() => ({ ...settings.models }))
  // `Add override` rows before a model is picked; not in the patch — an override needs a model.
  const [pending, setPending] = useState<StoryAgentId[]>([])

  const config = useMemo<ResolveModelConfig>(
    () => ({ providers, profiles, assignments }),
    [providers, profiles, assignments],
  )
  const sources = useMemo(() => providerSources(providers), [providers])
  const favorites = useMemo(() => providerFavorites(providers), [providers])

  const dirtyTargets = modelsDirtyTargets(draft, settings.models)
  useStorySettingsSection({
    id: 'models',
    tab: 'models',
    dirtyFields: dirtyTargets.map((target) => t(`storySettings:models.field.${target}`)),
    getPatch: () => ({ models: draft }),
    reset: () => {
      setDraft({ ...settings.models })
      setPending([])
    },
  })

  const setOverride = (target: StoryOverrideTarget, ref: ModelRef | null) => {
    setDraft((prev) => {
      const next: StoryModels = { ...prev }
      if (ref == null) delete next[target]
      else next[target] = { providerId: ref.providerId, modelId: ref.modelId }
      return next
    })
    if (target !== 'narrative') setPending((prev) => prev.filter((agent) => agent !== target))
  }

  const toggleFavorite = (ref: ModelRef) => {
    const provider = providers.find((p) => p.id === ref.providerId)
    if (provider == null) return
    const favoriteModelIds = toggledFavoriteIds(provider, ref.modelId)
    void updateProvider(provider.id, { favoriteModelIds }, ctx).catch((error: unknown) =>
      reportProviderWriteFailure('action_layer.provider_favorite_failed', provider.id, error),
    )
  }

  // provider-model-picker.md → custom-add composer: the host stores the id and selects it.
  const addCustom = (target: StoryOverrideTarget, ref: ModelRef) => {
    setOverride(target, ref)
    const provider = providers.find((p) => p.id === ref.providerId)
    if (provider == null || providerListsModel(provider, ref.modelId)) return
    void updateProvider(
      provider.id,
      { customModelIds: appendedCustomModelIds(provider, ref.modelId) },
      ctx,
    ).catch((error: unknown) =>
      reportProviderWriteFailure('action_layer.provider_add_custom_failed', provider.id, error),
    )
  }

  const rows = STORY_OVERRIDE_TARGETS.filter(
    (target) => target === 'narrative' || draft[target] != null || pending.includes(target),
  )
  const addable = availableAgents(draft, pending)
  const noProviders = providers.length === 0
  const pickerDisabledReason = disabled
    ? disabledReason
    : noProviders
      ? t('storySettings:models.noProviders')
      : undefined

  return (
    <View testID="models-panel" className="gap-4">
      <View className="gap-0.5">
        <Heading level={3}>{t('storySettings:models.heading')}</Heading>
        <Text size="sm" variant="muted">
          {t('storySettings:models.intro')}
        </Text>
      </View>

      {noProviders ? (
        <Text size="sm" variant="muted">
          {t('storySettings:models.noProviders')}
        </Text>
      ) : null}

      {rows.map((target) => {
        const override = draft[target]
        const chain = describeChain(target, config)
        const providerGone = override != null && overrideProviderMissing(override, providers)
        const label = targetLabel(target)
        return (
          <View key={target} testID={`model-row-${target}`} className="gap-1">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="font-medium">{label}</Text>
              {override != null || target !== 'narrative' ? (
                <IconAction
                  icon={X}
                  size="sm"
                  label={
                    override != null
                      ? t('storySettings:models.clearOverride', { target: label })
                      : t('storySettings:models.removeRow', { target: label })
                  }
                  disabled={disabled}
                  disabledReason={disabledReason}
                  onPress={() => setOverride(target, null)}
                />
              ) : null}
            </View>
            {override != null ? (
              providerGone ? (
                <Text size="sm" className="text-warning">
                  {t('storySettings:models.overrideProviderMissing')}
                </Text>
              ) : null
            ) : chain.kind === 'broken' ? (
              <Text size="sm" className="text-warning">
                {chainText(chain)}
              </Text>
            ) : (
              <Text size="sm" variant="muted" className="italic">
                {chainText(chain)}
              </Text>
            )}
            <ProviderModelPicker
              value={
                override == null
                  ? null
                  : { providerId: override.providerId, modelId: override.modelId }
              }
              onChange={(ref) => setOverride(target, ref)}
              placeholder={t('storySettings:models.pickModel')}
              providers={sources}
              favorites={favorites}
              onFavoriteToggle={toggleFavorite}
              onAddCustom={(ref) => addCustom(target, ref)}
              disabled={disabled || noProviders}
              disabledReason={pickerDisabledReason}
            />
          </View>
        )
      })}

      <Select
        mode="dropdown"
        label={t('storySettings:models.addOverrideLabel')}
        placeholder={t('storySettings:models.addOverride')}
        value={undefined}
        options={addable.map((agent) => ({
          value: agent,
          label: t(`storySettings:models.agent.${agent}`),
          description: chainText(describeChain(agent, config)),
        }))}
        renderRow={({ option }) => (
          <View className="flex-1">
            <Text size="sm">{option.label}</Text>
            {option.description != null ? (
              <Text size="xs" variant="muted">
                {option.description}
              </Text>
            ) : null}
          </View>
        )}
        onValueChange={(value) => {
          const agent = addable.find((candidate) => candidate === value)
          if (agent != null) setPending((prev) => [...prev, agent])
        }}
        disabled={disabled || noProviders || addable.length === 0}
      />
    </View>
  )
}

export type { ModelsPanelProps }
