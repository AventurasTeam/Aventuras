import type { ModelProfile, ProviderInstance } from '../db'
import type { ResolveTarget } from './agents'

export type ResolveModelConfig = {
  providers: ProviderInstance[]
  profiles: ModelProfile[]
  assignments: Record<string, string>
  defaultProviderId: string | null
  // stories.settings.models — narrative + 5 agents (no wizard-assist slot).
  storyModels?: Partial<Record<string, string>>
}

export type ResolvedParams = {
  temperature?: number
  maxOutput?: number
  thinking?: number
  timeout?: number
  structuredOutput?: 'auto' | 'force-on' | 'force-off'
  customJson?: Record<string, unknown>
}

export type ResolveFailureKind = 'no-profile-assigned' | 'profile-missing' | 'provider-missing'

export type ResolveModelResult =
  | { ok: true; providerId: string; modelId: string; params: ResolvedParams }
  | { ok: false; kind: ResolveFailureKind; target: ResolveTarget }

function paramsOf(profile: ModelProfile): ResolvedParams {
  return {
    ...(profile.temperature !== undefined ? { temperature: profile.temperature } : {}),
    ...(profile.maxOutput !== undefined ? { maxOutput: profile.maxOutput } : {}),
    ...(profile.thinking !== undefined ? { thinking: profile.thinking } : {}),
    ...(profile.timeout !== undefined ? { timeout: profile.timeout } : {}),
    ...(profile.structuredOutput !== undefined
      ? { structuredOutput: profile.structuredOutput }
      : {}),
    ...(profile.customJson !== undefined ? { customJson: profile.customJson } : {}),
  }
}

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
    modelId: profile.modelRef.modelId,
    params: paramsOf(profile),
  }
}

export function resolveModel(
  target: ResolveTarget,
  config: ResolveModelConfig,
): ResolveModelResult {
  const override = config.storyModels?.[target]
  if (override !== undefined) {
    // Bare model id, no provider component → runs on the default provider.
    const provider = config.providers.find((p) => p.id === config.defaultProviderId)
    if (provider === undefined) return { ok: false, kind: 'provider-missing', target }
    return { ok: true, providerId: provider.id, modelId: override, params: {} }
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
