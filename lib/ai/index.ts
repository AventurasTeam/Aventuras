export {
  AGENT_IDS,
  isStoryOverrideTarget,
  STORY_OVERRIDE_TARGETS,
  type AgentId,
  type ResolveTarget,
  type StoryOverrideTarget,
} from './agents'
export { fetchModelCatalog, normalizeModelCatalog } from './catalog'
export { embedViaProvider } from './embedding'
export type { ProviderInstanceWithStub } from './types'
export {
  generateStructured,
  parseStructured,
  profileTimeoutMs,
  streamText,
  type GenerateStructuredResult,
  type PromptHalves,
  type StreamTextOptions,
  type StreamTextResult,
  type StructuredCallOptions,
} from './generate'
// getModel + the retry/timeout trio are public for cross-module tests
// (pipeline fault injection) and lib/pipeline's CallRetryError mapping —
// production call paths go through streamText / generateStructured.
export { getModel } from './model'
export { callWithRetry, type CallRetryError } from './transport/call-with-retry'
export { describeProviderError, ProviderTimeoutError } from './transport/classify-provider-error'
export {
  resolveModel,
  type AppChainFailureKind,
  type ResolveModelConfig,
  type ResolveModelResult,
  type ResolveFailureKind,
  type ResolvedParams,
} from './resolve-model'
export { resolveModelCapabilities, type ModelCapabilities } from './model-capabilities'
export {
  describeReplyCutOff,
  isCutOff,
  replyCutOff,
  type CutOffCause,
  type ReplyCutOffFailure,
} from './reply-cut-off'
export { schemaToTypeScriptBlock, type JsonSchema } from './prompt-schema'
