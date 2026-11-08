export {
  AGENT_IDS,
  isStoryOverrideTarget,
  STORY_OVERRIDE_TARGETS,
  type AgentId,
  type ResolveTarget,
  type StoryOverrideTarget,
} from './agents'
export { CALL_TIMEOUT_DEFAULT_MS, callTimeoutMs, providerTimeoutDetail } from './call-timeout'
export { fetchModelCatalog, normalizeModelCatalog, type CatalogEntry } from './catalog'
export {
  ContextWindowError,
  describeContextWindow,
  displayEstimate,
  generationWindow,
  type ContextWindowFailure,
  type GenerationWindow,
} from './context-window'
export { embedViaProvider } from './embedding'
export type { ProviderInstanceWithStub } from './types'
export {
  describeCallRetryError,
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
// getModel + the retry/timeout trio are public for cross-module tests (pipeline fault injection)
// and lib/pipeline's CallRetryError mapping; production calls go through streamText and generate*.
export { getModel } from './model'
export { callWithRetry, type CallRetryError } from './transport/call-with-retry'
export {
  describeProviderError,
  ProviderTimeoutError,
  streamErrorReason,
  type CapabilityHint,
  type ProviderReason,
} from './transport/classify-provider-error'
export { configureTruncationNotice, type TruncationNotice } from './truncation-check'
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
  replyStopOf,
  type CutOffCause,
  type ReplyCutOffFailure,
} from './reply-cut-off'
export { schemaToTypeScriptBlock, type JsonSchema } from './prompt-schema'
export {
  generateToolStep,
  TOOL_STEP_MAX_OUTPUT_DEFAULT,
  type ToolStep,
  type ToolStepCall,
  type ToolStepInvalidCall,
  type ToolStepRequest,
  type ToolStepResult,
  type ToolStepTool,
} from './tool-step'
