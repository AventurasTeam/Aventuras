/**
 * AI Core Module
 *
 * Core infrastructure for AI services including:
 * - Configuration: Centralized config constants and logging
 * - Types: All API types and interfaces
 * - Request utilities: Extra body building, provider config
 */

// Configuration and logging
export { AI_CONFIG, DEBUG, createLogger, type Logger } from './config'

// Types
export type {
  AIProvider,
  GenerationRequest,
  GenerationResponse,
  StreamChunk,
  ModelInfo,
  ProviderInfo,
  Message,
  AgenticRequest,
  AgenticResponse,
  Tool,
  ToolCall,
  ToolFunction,
  ToolParameter,
  ToolCallMessage,
  ToolResultMessage,
  AgenticMessage,
  AgenticStreamChunk,
  ReasoningDetail,
  ReasoningDetailFormat,
  ReasoningDetailBase,
  ReasoningSummaryDetail,
  ReasoningEncryptedDetail,
  ReasoningTextDetail,
} from './types'

// Request utilities
export {
  buildExtraBody,
  buildReasoningConfig,
  buildProviderConfig,
  parseManualBody,
  sanitizeManualBody,
  buildManualBodyDefaults,
  serializeManualBody,
  type ExtraBodyOptions,
  type ManualBodyDefaults,
} from './requestOverrides'
