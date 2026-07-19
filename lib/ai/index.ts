export { AGENT_IDS, type AgentId, type ResolveTarget } from './agents'
export { fetchModelCatalog } from './catalog'
export {
  generateStructured,
  parseStructured,
  streamText,
  type GenerateStructuredResult,
  type StreamTextOptions,
  type StreamTextResult,
} from './generate'
// getModel + the retry/timeout trio are public for cross-module tests
// (pipeline fault injection) and lib/pipeline's CallRetryError mapping —
// production call paths go through streamText / generateStructured.
export { getModel } from './model'
export { callWithRetry, type CallRetryError } from './transport/call-with-retry'
export { ProviderTimeoutError } from './transport/classify-provider-error'
export {
  resolveModel,
  type ResolveModelConfig,
  type ResolveModelResult,
  type ResolveFailureKind,
  type ResolvedParams,
} from './resolve-model'
