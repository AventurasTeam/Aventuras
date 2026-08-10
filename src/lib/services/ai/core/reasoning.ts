/**
 * The reasoning vocabulary.
 *
 * A leaf module on purpose: it imports only types. Every question about reasoning effort --
 * is it on, is a model forced to think, what does a capability do to a chosen level, what do
 * we call it in the UI -- is answered here and nowhere else.
 *
 * It exists because those questions used to be answered in seven places. When the UI learned
 * that only NanoGPT's `:thinking` variants really enforce reasoning, the store that forced the
 * level did not, and NanoGPT users could no longer turn reasoning off at all.
 *
 * Note there is no 'off': the value is 'none'. `settingsMigrations` recognises the pre-0.7.x
 * on-disk spelling and is the only place allowed to.
 */

import type { ProviderType, ReasoningEffort } from '$lib/types'

/** Every level, ascending. Index order is the slider's order. */
export const REASONING_LEVELS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
}

/** Same levels, for the tick marks under the slider where the full words do not fit. */
export const REASONING_SHORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'Extra',
}

/**
 * Reasoning is on at every level except 'none'.
 *
 * 'none' is a value we *send*, not one we omit: it is what tells a provider to stop thinking.
 * Omitting the parameter asks for the model's default instead, which is not the same request.
 */
export function isReasoningOn(effort: ReasoningEffort | undefined): boolean {
  return !!effort && effort !== 'none'
}

/**
 * NanoGPT publishes a model's thinking variant as its own id -- `zai-org/glm-5:thinking`.
 * That id *is* the reasoning model, so asking it for 'none' is a self-contradictory request:
 * it thinks anyway and the UI would claim otherwise.
 *
 * Kept to NanoGPT because it is NanoGPT's naming convention; another provider's `:thinking`
 * suffix would need its own evidence before being read the same way.
 */
export function reasoningIsEnforced(providerType: ProviderType, modelId: string): boolean {
  return providerType === 'nanogpt' && /[-:]thinking(?::.+)?$/i.test(modelId)
}

/** What a profile/model pair allows. */
export type ReasoningCapability = 'enforced' | 'supported' | 'unsupported'

export interface ReasoningCapabilityInput {
  providerType: ProviderType
  modelId: string
  /** Does the provider do reasoning at all. */
  providerSupportsReasoning: boolean
  /** Does the provider publish per-model capabilities. When it does not, the model flag is a guess. */
  providerFetchesModelCapabilities: boolean
  /** The fetched catalogue's flag for this model, `undefined` when unknown. */
  modelSupportsReasoning: boolean | undefined
}

export function reasoningCapabilityFor({
  providerType,
  modelId,
  providerSupportsReasoning,
  providerFetchesModelCapabilities,
  modelSupportsReasoning,
}: ReasoningCapabilityInput): ReasoningCapability {
  if (!modelId || !providerSupportsReasoning) return 'unsupported'
  // Only a provider that publishes capabilities can say a model has none; elsewhere the
  // absent flag means "unknown", and refusing reasoning on unknown would disable the slider
  // for every provider that does not have a catalogue.
  if (providerFetchesModelCapabilities && !modelSupportsReasoning) return 'unsupported'
  if (modelSupportsReasoning && reasoningIsEnforced(providerType, modelId)) return 'enforced'
  return 'supported'
}

/**
 * Where an enforced model lands when the stored level is 'none'.
 *
 * A floor, not a preference: it only has to be a level the model accepts. 'high' -- what this
 * used to force -- also billed the user for reasoning depth nobody asked for.
 */
export const ENFORCED_REASONING_FLOOR: ReasoningEffort = 'medium'

/**
 * The single rule for what a capability does to a chosen level. Pure, so the UI effect that
 * applies it is two lines and this is what carries the tests.
 */
export function clampReasoningToCapability(
  effort: ReasoningEffort,
  capability: ReasoningCapability,
): ReasoningEffort {
  switch (capability) {
    case 'unsupported':
      return 'none'
    case 'enforced':
      return isReasoningOn(effort) ? effort : ENFORCED_REASONING_FLOOR
    case 'supported':
      // Including 'none'. A model that merely *supports* reasoning can be told not to.
      return effort
  }
}
