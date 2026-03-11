/**
 * Provider Registry
 *
 * Single entry point for all Vercel AI SDK provider operations.
 */

export { createProviderFromProfile } from './registry'
export { dedupeTextModels, fetchModelsFromProvider, type TextModel } from './modelFetcher'
export {
  PROVIDERS,
  getBaseUrl,
  hasDefaultEndpoint,
  getProviderList,
  supportsReasoning,
  supportsBinaryReasoning,
  supportsCapabilityFetch,
  getReasoningExtraction,
  type ProviderConfig,
  type ProviderServices,
  type ServiceModelDefaults,
  type ProviderCapabilities,
  type ImageDefaults,
} from './config'
export type { ProviderType, APIProfile } from '$lib/types'
