import type { ModelProfile, ModelSettings, ProviderInstance, StorySettings } from '../db'
import { isStoryOverrideTarget, type ResolveTarget } from './agents'
import { modelSettingsOf } from './model-settings'

export type ResolveModelConfig = {
  providers: readonly ProviderInstance[]
  profiles: readonly ModelProfile[]
  assignments: Readonly<Record<string, string>>
  storyModels?: StorySettings['models']
}

/** Breakage in the App Settings chain: assignment → profile → the profile's provider. */
export type AppChainFailureKind = 'no-profile-assigned' | 'profile-missing' | 'provider-missing'

// A story override carries its own provider, so its breakage is repaired on that
// story's Models tab — App Settings has nothing to fix.
export type ResolveFailureKind = AppChainFailureKind | 'override-provider-missing'

export type ResolveModelResult =
  | {
      ok: true
      providerId: string
      providerType: ProviderInstance['type']
      modelId: string
      /** The call settings of the override or profile the walk stopped at; unset fields absent. */
      params: ModelSettings
      /** The settings are the story override's, not a profile's: a failure's copy names whose. */
      fromOverride: boolean
      /** The profile the chain landed on. Absent when a story override short-circuited it. */
      profileId?: string
    }
  | { ok: false; kind: ResolveFailureKind; target: ResolveTarget }

function fromProfile(
  profile: ModelProfile,
  config: ResolveModelConfig,
  target: ResolveTarget,
): ResolveModelResult {
  const provider = config.providers.find((p) => p.id === profile.modelRef.providerId)
  if (provider === undefined) return { ok: false, kind: 'provider-missing', target }
  return {
    ok: true,
    providerId: provider.id,
    providerType: provider.type,
    modelId: profile.modelRef.modelId,
    params: modelSettingsOf(profile),
    fromOverride: false,
    profileId: profile.id,
  }
}

export function resolveModel(
  target: ResolveTarget,
  config: ResolveModelConfig,
): ResolveModelResult {
  // Global agents run outside any story, so they never read story overrides.
  const override = isStoryOverrideTarget(target) ? config.storyModels?.[target] : undefined
  if (override !== undefined) {
    const provider = config.providers.find((p) => p.id === override.providerId)
    if (provider === undefined) return { ok: false, kind: 'override-provider-missing', target }
    return {
      ok: true,
      providerId: provider.id,
      providerType: provider.type,
      modelId: override.modelId,
      params: modelSettingsOf(override),
      fromOverride: true,
    }
  }

  if (target === 'narrative') {
    const profile = config.profiles.find((p) => p.kind === 'narrative')
    if (profile === undefined) return { ok: false, kind: 'no-profile-assigned', target }
    return fromProfile(profile, config, target)
  }

  const profileId = config.assignments[target]
  if (profileId === undefined) return { ok: false, kind: 'no-profile-assigned', target }
  const profile = config.profiles.find((p) => p.id === profileId)
  if (profile === undefined) return { ok: false, kind: 'profile-missing', target }
  return fromProfile(profile, config, target)
}
