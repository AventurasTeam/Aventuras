/**
 * Preset -> profile -> model, in one place.
 *
 * Three call sites resolved this independently -- `resolveConfig` and `resolveNarrativeConfig`
 * in `generate.ts` and `resolveAgentConfig` in `agents/factory.ts`, the last of which carried a
 * comment saying it followed the first. The structured-output switch, the model construction
 * and the think-tag test were each written more than once, and had already drifted: the agent
 * path dropped the preset's manual request body, and one narrative path tested for think-tag
 * providers without the `openai-compatible` half of the condition.
 */

import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { GroqProviderOptions } from '@ai-sdk/groq'
import type { MistralLanguageModelOptions } from '@ai-sdk/mistral'
import type { JSONObject, LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'
import type { XaiProviderOptions } from '@ai-sdk/xai'
import type { PollinationsLanguageModelSettings } from 'ai-sdk-pollinations'

import { settings } from '$lib/stores/settings.svelte'
import type { APIProfile, GenerationPreset, ProviderType, ReasoningEffort } from '$lib/types'
import { isReasoningOn } from '$lib/services/ai/core/reasoning'
import { createModelFromProfile } from './providers'
import { GOOGLE_SAFETY_SETTINGS, PROVIDERS, usesThinkTag } from './providers/config'

// ============================================================================
// Provider Options
// ============================================================================

const PROVIDER_OPTIONS_KEY: Record<ProviderType, string> = {
  openrouter: 'openrouter',
  nanogpt: 'nanogpt',
  chutes: 'chutes',
  pollinations: 'pollinations',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  llamacpp: 'llamacpp',
  // Hyphenated provider names are looked up under their camelCase form; the SDK still
  // reads the raw one but emits a deprecation warning for it.
  'nvidia-nim': 'nvidiaNim',
  'openai-compatible': 'openaiCompatible',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
  groq: 'groq',
  zhipu: 'zhipu',
  deepseek: 'deepseek',
  mistral: 'mistral',
}

/**
 * Build provider-specific options from preset settings.
 *
 * Note that 'none' is sent, not omitted: it is the value that switches thinking off. The SDK's
 * own `reasoning` field would drop it, which is why the effort travels in provider options.
 */
export function buildProviderOptions(
  preset: GenerationPreset,
  providerType: ProviderType,
): SharedV4ProviderOptions | undefined {
  let options: JSONObject = {}

  const reasoning_effort = preset.reasoningEffort
  const reasoningOn = isReasoningOn(reasoning_effort)

  if (!settings.advancedRequestSettings.manualMode) {
    switch (providerType) {
      case 'xai':
        options = { parallel_function_calling: true } satisfies XaiProviderOptions
        break
      case 'google': {
        // Reinject safety settings here for complete model-request coverage
        options = {
          safetySettings: GOOGLE_SAFETY_SETTINGS,
        } satisfies GoogleGenerativeAIProviderOptions
        if (reasoningOn) {
          options = {
            ...options,
            thinkingConfig: { includeThoughts: true },
          } satisfies GoogleGenerativeAIProviderOptions
        }
        break
      }
      // Everything built by `createOpenAICompatible` (see `providers/registry.ts`).
      //
      // camelCase, not snake_case: the SDK spreads unknown options into the body and then
      // assigns `reasoning_effort` from its own parsed `reasoningEffort`, so the later key
      // wins and a snake_case value is overwritten with `undefined` and dropped.
      case 'nanogpt':
      case 'llamacpp':
      case 'lmstudio':
      case 'ollama':
      case 'chutes':
      case 'nvidia-nim':
      case 'openai-compatible':
        options = { reasoningEffort: reasoning_effort }
        break
      case 'pollinations':
        options = {
          reasoning_effort,
          parallel_tool_calls: true,
        } satisfies PollinationsLanguageModelSettings
        break
      case 'groq':
        options = { parallelToolCalls: true } satisfies GroqProviderOptions
        break
      case 'zhipu':
        // Also `createOpenAICompatible`, so `reasoningEffort` for the reason above.
        // `thinking` is not a key the SDK knows, so it passes through the spread.
        if (reasoningOn) {
          options = {
            thinking: { type: 'enabled' },
            reasoningEffort: reasoning_effort,
          }
        } else {
          // The effort key is dropped here on purpose: `thinking: disabled` is what
          // suppresses it, and sending both says two things about one setting.
          options = {
            thinking: { type: 'disabled' },
          }
        }
        break
      case 'mistral':
        options = {
          safePrompt: false,
          parallelToolCalls: true,
        } satisfies MistralLanguageModelOptions
        break
    }
  }

  if (Object.keys(options).length === 0) {
    return undefined
  }

  const providerKey = PROVIDER_OPTIONS_KEY[providerType]
  return { [providerKey]: options }
}

// ============================================================================
// Structured output
// ============================================================================

/**
 * Whether to ask this model for native structured output.
 *
 * 'auto' trusts a published per-model capability where the provider has one, and the
 * provider-level default everywhere else.
 */
export function resolveStructuredOutputs(
  preset: GenerationPreset,
  providerType: ProviderType,
  modelSupportsStructuredOutput: boolean | undefined,
): boolean {
  switch (preset.structuredOutputOverride) {
    case 'on':
      return true
    case 'off':
      return false
    case 'auto':
    default: {
      const capabilities = PROVIDERS[providerType].capabilities
      return capabilities?.modelCapabilityFetching
        ? !!modelSupportsStructuredOutput
        : (capabilities?.structuredOutput ?? true)
    }
  }
}

/**
 * Whether the "Thinking nudge" setting can do anything for this configuration.
 *
 * The nudge only ever reaches the model through the prompt-injected schema, so it needs all
 * three: a provider whose reasoning arrives in `<think>` tags, reasoning actually switched on,
 * and no native structured output to carry the schema instead. The UI asks the same question
 * before offering the toggle, so nobody can switch on something inert.
 */
export function thinkingNudgeApplies({
  providerType,
  reasoningEffort,
  supportsStructuredOutput,
}: {
  providerType: ProviderType
  reasoningEffort: ReasoningEffort | undefined
  supportsStructuredOutput: boolean
}): boolean {
  return usesThinkTag(providerType) && isReasoningOn(reasoningEffort) && !supportsStructuredOutput
}

// ============================================================================
// Resolution
// ============================================================================

export interface ResolvedPreset {
  preset: GenerationPreset
  profile: APIProfile
  providerType: ProviderType
  model: LanguageModelV4
  providerOptions?: SharedV4ProviderOptions
  reasoning: ReasoningEffort
  supportsStructuredOutput: boolean
  useThinkTag: boolean
}

export interface ResolvePresetOptions {
  presetId: string
  serviceId: string
  debugId?: string
}

export function resolvePresetModel({
  presetId,
  serviceId,
  debugId,
}: ResolvePresetOptions): ResolvedPreset {
  const preset = settings.getPresetConfig(presetId, serviceId)
  const profileId = preset.profileId ?? settings.apiSettings.mainNarrativeProfileId
  const profile = settings.getProfile(profileId)

  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`)
  }

  const fetchedModel = settings.getProfileModels(profileId).find((m) => m.id === preset.model)
  const supportsStructuredOutput = resolveStructuredOutputs(
    preset,
    profile.providerType,
    fetchedModel?.structuredOutput,
  )

  const model = createModelFromProfile({
    profile,
    modelId: preset.model,
    presetId: serviceId,
    debugId,
    structuredOutputs: supportsStructuredOutput,
    manualBody: preset.manualBody ?? '',
    serviceId,
  })

  return {
    preset,
    profile,
    providerType: profile.providerType,
    model,
    providerOptions: buildProviderOptions(preset, profile.providerType),
    reasoning: preset.reasoningEffort,
    supportsStructuredOutput,
    useThinkTag: usesThinkTag(profile.providerType),
  }
}
