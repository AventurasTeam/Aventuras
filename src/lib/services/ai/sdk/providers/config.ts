import { PROVIDERS } from '$lib/constants/providerConfig'
import type { ProviderCapabilities, ProviderType } from '$lib/types'

// ============================================================================
// Helper Functions
// ============================================================================

/** Get the base URL for a provider, or undefined if SDK default should be used */
export function getBaseUrl(providerType: ProviderType): string | undefined {
  const url = PROVIDERS[providerType].baseUrl
  return url || undefined
}

/** Check if a provider has a default endpoint (doesn't require custom URL) */
export function hasDefaultEndpoint(providerType: ProviderType): boolean {
  return providerType !== 'openai-compatible'
}

/** Get all providers as a list for UI dropdowns */
export function getProviderList(): Array<{
  value: ProviderType
  label: string
  description: string
}> {
  return (Object.keys(PROVIDERS) as ProviderType[]).map((key) => ({
    value: key,
    label: PROVIDERS[key].name,
    description: PROVIDERS[key].description,
  }))
}

/** Check if a provider supports reasoning/thinking */
export function supportsReasoning(providerType: ProviderType): boolean {
  return !!PROVIDERS[providerType].capabilities.reasoning
}

/** Check if a provider uses binary (on/off) reasoning instead of a level slider */
export function supportsBinaryReasoning(providerType: ProviderType): boolean {
  return !!PROVIDERS[providerType].capabilities.binaryReasoning
}

/** Check if a provider supports capability fetching */
export function supportsCapabilityFetch(providerType: ProviderType): boolean {
  return !!PROVIDERS[providerType].capabilities.modelCapabilityFetching
}

/** Get the reasoning extraction method for a provider */
export function getReasoningExtraction(
  providerType: ProviderType,
): ProviderCapabilities['reasoningExtraction'] {
  return PROVIDERS[providerType].capabilities.reasoningExtraction
}
