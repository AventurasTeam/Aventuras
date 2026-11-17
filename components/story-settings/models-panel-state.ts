import type {
  ModelEntry,
  ModelRef,
  ProviderSource,
} from '@/components/compounds/provider-model-picker'
import {
  overrideSettingsOf,
  resolveModel,
  STORY_OVERRIDE_TARGETS,
  type ResolveFailureKind,
  type ResolveModelConfig,
  type ResolveModelResult,
  type StoryOverrideTarget,
} from '@/lib/ai'
import {
  STORY_AGENT_IDS,
  type ModelOverride,
  type ProviderInstance,
  type StoryAgentId,
  type StorySettings,
} from '@/lib/db'
import { deepEqual } from '@/lib/deep-equal'

export type ChainDescription =
  | { kind: 'resolved'; modelId: string; profileName: string | null }
  | { kind: 'broken'; failure: ResolveFailureKind }

// The App Settings chain beneath any override: what the sentinel shows, and what an override copies.
function resolveChain(target: StoryOverrideTarget, config: ResolveModelConfig): ResolveModelResult {
  return resolveModel(target, { ...config, storyModels: undefined })
}

/** The App Settings chain beneath any override — what the sentinel shows. */
export function describeChain(
  target: StoryOverrideTarget,
  config: ResolveModelConfig,
): ChainDescription {
  const result = resolveChain(target, config)
  if (!result.ok) return { kind: 'broken', failure: result.kind }
  const profile =
    result.profileId == null ? undefined : config.profiles.find((p) => p.id === result.profileId)
  return { kind: 'resolved', modelId: result.modelId, profileName: profile?.name ?? null }
}

// A catalog refresh can start listing an id the user added as custom; the picker keys rows by id.
function uniqueById(models: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

export function providerSources(providers: readonly ProviderInstance[]): ProviderSource[] {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.displayName,
    models: uniqueById([
      ...(provider.cachedModels ?? []).map((model) => ({
        id: model.id,
        capabilities:
          model.capabilities == null
            ? undefined
            : {
                ...(model.capabilities.reasoning != null
                  ? { reasoning: model.capabilities.reasoning }
                  : {}),
                ...(model.capabilities.structuredOutput != null
                  ? { structured: model.capabilities.structuredOutput }
                  : {}),
              },
      })),
      ...(provider.customModelIds ?? []).map((id) => ({ id, capabilities: undefined })),
    ]),
  }))
}

export function providerFavorites(providers: readonly ProviderInstance[]): ModelRef[] {
  return providers.flatMap((provider) =>
    provider.favoriteModelIds.map((modelId) => ({ providerId: provider.id, modelId })),
  )
}

/** Whether `modelId` is already in the provider's catalog or among its custom ids. */
export function providerListsModel(provider: ProviderInstance, modelId: string): boolean {
  return (
    (provider.cachedModels ?? []).some((model) => model.id === modelId) ||
    (provider.customModelIds ?? []).includes(modelId)
  )
}

export function overrideProviderMissing(
  ref: ModelOverride,
  providers: readonly ProviderInstance[],
): boolean {
  return !providers.some((provider) => provider.id === ref.providerId)
}

// Both of these write a whole provider-level list back, so they carry the rest of
// it: the ids belong to the provider, not to the override being edited.

/** The provider's favorites with `modelId` toggled — never duplicated, never dropped. */
export function toggledFavoriteIds(
  provider: Pick<ProviderInstance, 'favoriteModelIds'>,
  modelId: string,
): string[] {
  return provider.favoriteModelIds.includes(modelId)
    ? provider.favoriteModelIds.filter((id) => id !== modelId)
    : [...provider.favoriteModelIds, modelId]
}

/** The provider's custom ids with `modelId` appended, leaving the existing ones in place. */
export function appendedCustomModelIds(
  provider: Pick<ProviderInstance, 'customModelIds'>,
  modelId: string,
): string[] {
  const current = provider.customModelIds ?? []
  return current.includes(modelId) ? [...current] : [...current, modelId]
}

/**
 * The override a model pick leaves on `target` (story-settings.md → An override row). An existing
 * one keeps its settings, a broken-provider one too. A new one copies what the chain resolves to,
 * limited to the slot's fields; a broken chain copies nothing.
 */
export function pickedOverride(
  target: StoryOverrideTarget,
  ref: ModelRef,
  current: ModelOverride | undefined,
  config: ResolveModelConfig,
): ModelOverride {
  const model = { providerId: ref.providerId, modelId: ref.modelId }
  if (current != null) return { ...current, ...model }
  const chain = resolveChain(target, config)
  return chain.ok ? { ...model, ...overrideSettingsOf(target, chain.params) } : model
}

// A settings change marks the slot as a new model does.
export function modelsDirtyTargets(
  draft: StorySettings['models'],
  stored: StorySettings['models'],
): StoryOverrideTarget[] {
  return STORY_OVERRIDE_TARGETS.filter((target) => !deepEqual(draft[target], stored[target]))
}

/** Agents the `Add override` picker still offers: no override and no pending row. */
export function availableAgents(
  draft: StorySettings['models'],
  pending: readonly StoryAgentId[],
): StoryAgentId[] {
  return STORY_AGENT_IDS.filter((agent) => draft[agent] == null && !pending.includes(agent))
}
